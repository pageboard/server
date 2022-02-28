const { transaction } = require('objection');
const Path = require('path');

const bodyParser = require.lazy('body-parser');
const jsonPath = require.lazy('@kapouer/path');

const Packager = require.lazy('./lib/packager');
const { validate } = require('./lib/ajv');
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
		this.app = app;

		this.opts = Object.assign(opts, {
			seeds: [Path.join(__dirname, 'seeds')],
			migrations: [Path.join(__dirname, 'migrations')]
		});
	}

	apiRoutes(app, server) {
		const tenantsLen = Object.keys(this.app.opts.database.url).length - 1;
		// api depends on site files, that tag is invalidated in cache install
		server.get('/.api/*', this.app.cache.tag('app-:site'), this.app.cache.tag('db-:tenant').for(`${tenantsLen}day`));
		server.use('/.api/*',
			// invalid site by site
			this.app.cache.tag('data-:site'),
			// parse json bodies
			bodyParser.json({ limit: '1000kb' })
		);
	}

	async install(...args) {
		if (!this.#packager) this.#packager = new Packager(this.app, Block);
		return this.#packager.run(...args);
	}

	validate(schema, data, inst) {
		try {
			data = validate(schema, data, inst || {});
		} catch (err) {
			if (!inst) return false;
			else throw err;
		}
		if (!inst) return true;
		else return data;
	}

	#getService(apiStr) {
		const [modName, funName] = apiStr.split('.');
		const mod = this.app.services[modName];
		if (!mod) {
			throw new HttpError.BadRequest(Text`
				Unknown api module ${modName}
					${Object.keys(this.app.services).sort().join(', ')}
			`);
		}
		const schema = mod[funName];
		const inst = this.app[modName];
		const fun = inst[funName];
		if (!fun) throw new HttpError.BadRequest(Text`
			Unknown api method ${apiStr}
				${Object.keys(mod).sort().join(', ')}
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

	async run(apiStr, req, data) {
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
		Object.assign(req, { Block, Href, app });

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
			console.trace("All.send expects an object, got", obj);
			obj = {};
		}
		if (obj.cookies) {
			const cookieParams = {
				httpOnly: true,
				sameSite: true,
				secure: req.site.url.protocol == "https:",
				path: '/'
			};
			Object.keys(obj.cookies).forEach((key) => {
				const cookie = obj.cookies[key];
				const val = cookie.value;
				const maxAge = cookie.maxAge;

				if (val == null || maxAge == 0) res.clearCookie(key, cookieParams);
				else res.cookie(key, val, Object.assign({}, cookieParams, {
					maxAge: maxAge
				}));
			});
			delete obj.cookies;
		}
		// client needs to know what keys are supposed to be available
		obj.grants = {};
		(req.user.grants || []).forEach((grant) => {
			obj.grants[grant] = true;
		});
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
		this.app.auth.headers(res, req.locks);
		res.json(obj);
	}
};

function itemFn(schema, block) {
	if (block._id) {
		console.trace("removing _id", block._id);
	}
	if (!schema.upgrade) return;
	for (const [src, dst] of Object.entries(schema.upgrade)) {
		const val = jsonPath.get(block, src);
		if (val !== undefined) {
			jsonPath.set(block, dst, val);
			jsonPath.unSet(block, src);
		}
	}
}

