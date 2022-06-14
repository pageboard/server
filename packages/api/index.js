const { transaction } = require('objection');
const Path = require('node:path');

const bodyParser = require.lazy('body-parser');
const jsonPath = require.lazy('@kapouer/path');

const Packager = require.lazy('./lib/packager');
const Validation = require('./lib/validation');
const jsonDoc = require.lazy('./lib/json-doc');

const Href = require('./models/href');
const Block = require('./models/block');

module.exports = class ApiModule {
	static name = 'api';
	static priority = -1;
	static plugins = [
		'user', 'site', 'archive', 'settings', 'page',
		'block', 'href', 'form', 'query',	'reservation'
	].map(name => Path.join(__dirname, 'services', name));

	#packager;

	constructor(app, opts) {
		this.validation = new Validation(app, opts);
		Href.createValidator = Block.createValidator = () => {
			return this.validation.createValidator();
		};
		this.app = app;

		this.opts = {
			...opts,
			migrations: [Path.join(__dirname, 'migrations')]
		};
	}

	apiRoutes(app, server) {
		const tenantsLen = Object.keys(app.opts.database.url).length - 1;
		// api depends on site files, that tag is invalidated in cache install
		server.get('/.api/*',
			app.cache.tag('app-:site'),
			app.cache.tag('db-:tenant').for(`${tenantsLen}day`)
		);
		server.use('/.api/*',
			// invalid site by site
			app.cache.tag('data-:site'),
			// parse json bodies
			bodyParser.json({ limit: '1000kb' })
		);
	}

	async install(...args) {
		if (!this.#packager) this.#packager = new Packager(this.app, Block);
		return this.#packager.run(...args);
	}

	async finishInstall(site, pkg) {
		return this.#packager.finishInstall(site, pkg);
	}

	validate(schema, data, inst) {
		if (schema.properties && !schema.type) {
			schema.type = 'object';
		}
		try {
			data = this.validation.validate(schema, data, inst || {});
		} catch (err) {
			if (!inst) return false;
			else throw err;
		}
		if (!inst) return true;
		else return data;
	}

	#getService(apiStr) {
		const [modName, funName] = (apiStr || "").split('.');
		const mod = this.app.services[modName];
		if (!modName || !mod) {
			throw new HttpError.BadRequest(Text`
				Available modules:
				${Object.keys(this.app.services).sort().join(', ')}
			`);
		}
		const schema = mod[funName];
		const inst = this.app[modName];
		const fun = inst[funName];
		if (!funName || !fun) throw new HttpError.BadRequest(Text`
			Available methods:
			${Object.getOwnPropertyNames(mod).sort().join(', ')}
		`);
		if (!schema) {
			throw new HttpError.BadRequest(`Internal api method ${apiStr}`);
		}
		return [schema, inst, fun];
	}

	help(apiStr) {
		const [schema] = this.#getService(apiStr);
		return jsonDoc(schema, this.app.opts.cli);
	}

	async run(req = {}, apiStr, data = {}) {
		const { app } = this;
		const [schema, mod, fun] = this.#getService(apiStr);
		Log.api("run %s:\n%O", apiStr, data);
		try {
			data = this.validate(schema, data, fun);
		} catch (err) {
			err.message += '\n ' + apiStr + '\n' + jsonDoc(schema, app.opts.cli);
			throw err;
		}
		// start a transaction on set trx object on site
		let hadTrx = false;
		const { locals = { } } = req.res || { };

		if (req.trx) {
			hadTrx = true;
		} else {
			req.trx = await transaction.start(app.database.tenant(locals.tenant));
		}
		Object.assign(req, { Block, Href });

		const args = [req, data];

		try {
			const obj = await fun.apply(mod, args);
			if (!hadTrx && req.trx && !req.trx.isCompleted()) {
				await req.trx.commit();
			}
			return obj;
		} catch(err) {
			Log.api("error %s:\n%O", apiStr, err);
			if (!hadTrx && !req.trx.isCompleted()) {
				await req.trx.rollback();
			}
			throw err;
		} finally {
			if (req.trx && req.trx.isCompleted()) {
				if (hadTrx) {
					req.trx = transaction.start(app.database.tenant(locals.tenant));
				} else {
					delete req.trx;
				}
			}
		}
	}

	send(res, obj) {
		const req = res.req;
		if (obj == null || typeof obj != "object") {
			// eslint-disable-next-line no-console
			console.trace("app.send expects an object, got", obj);
			obj = {};
		}
		if (obj.cookies) {
			const cookieParams = {
				httpOnly: true,
				sameSite: true,
				secure: req.site.url.protocol == "https:",
				path: '/'
			};
			for (const [key, cookie] of Object.entries(obj.cookies)) {
				const val = cookie.value;
				const maxAge = cookie.maxAge;

				if (val == null || maxAge == 0) {
					res.clearCookie(key, cookieParams);
				} else res.cookie(key, val, {
					...cookieParams,
					maxAge: maxAge
				});
			}
			delete obj.cookies;
		}
		// client needs to know what keys are supposed to be available
		obj.grants = Object.fromEntries(
			(req.user.grants ?? []).map(grant => [grant, true])
		);
		if (obj.status) {
			res.status(obj.status);
			delete obj.status;
		}

		obj = this.app.auth.filterResponse(req, obj, itemFn);
		if (obj.item && !obj.item.type) {
			// 401 Unauthorized: missing or bad authentication
			// 403 Forbidden: authenticated but not authorized
			res.status(req.user.id ? 403 : 401);
		}
		if (req.granted) res.set('X-Granted', 1);
		req.call('auth.headers', req.locks);
		res.json(obj);
	}
};

function itemFn(schema, block) {
	if (!schema.upgrade) return;
	for (const [src, dst] of Object.entries(schema.upgrade)) {
		const val = jsonPath.get(block, src);
		if (val !== undefined) {
			jsonPath.set(block, dst, val);
			jsonPath.unSet(block, src);
		}
	}
}

