const { transaction, fn: fun, val, ref, raw } = require('objection');
const Path = require('node:path');

const bodyParser = require.lazy('body-parser');
const jsonPath = require.lazy('@kapouer/path');

const Packager = require.lazy('./lib/packager');
const Validation = require('./lib/validation');

const Href = require('./models/href');
const Block = require('./models/block');

const { mergeRecursive, mergeExpressions } = require('../../src/utils');

module.exports = class ApiModule {
	static name = 'api';
	static priority = -1;
	static plugins = [
		'help', 'user', 'site', 'archive', 'settings', 'page',
		'block', 'href', 'form', 'query',	'reservation', 'translate'
	].map(name => Path.join(__dirname, 'services', name));

	#packager;
	#validation;

	schemas = {};

	constructor(app, opts) {
		this.app = app;

		this.opts = {
			...opts,
			migrations: [Path.join(__dirname, 'migrations')]
		};

		Href.createValidator = Block.createValidator = () => {
			return this.validation.createValidator();
		};
	}

	get validation() {
		if (!this.#validation) {
			this.#validation = new Validation(this.app, this.opts);
		}
		return this.#validation;
	}

	apiRoutes(app, server) {
		app.responseFilter.register(this);
		const tenantsLen = Object.keys(app.opts.database.url).length - 1;
		// api depends on site files, that tag is invalidated in cache install
		server.get('/.api/*',
			app.cache.tag('app-:site', 'data-:site'),
			app.cache.tag('db-:tenant').for(`${tenantsLen}day`)
		);
		server.use('/.api/*',
			// parse json bodies
			bodyParser.json({ limit: '1000kb' }),
			bodyParser.urlencoded({ extended: false, limit: '100kb' })
		);
	}

	async install(...args) {
		if (!this.#packager) this.#packager = new Packager(this.app, Block);
		return this.#packager.run(...args);
	}

	async makeBundles(site, pkg) {
		await this.#packager.makeSchemas(site, pkg);
		return this.#packager.makeBundles(site, pkg);
	}

	validate(schema, data, inst) {
		if (schema.properties && !schema.type) {
			schema.type = 'object';
		}
		try {
			this.validation.validate(schema, data, inst || {});
		} catch (err) {
			if (!inst) return false;
			else throw err;
		}
		if (!inst) return true;
		else return data;
	}

	async add(p) {
		const schemas = await p;
		Object.assign(this.schemas, schemas);
		return schemas;
	}

	getService({ site }, apiStr) {
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
		const meth = inst[funName];
		if (!funName || !meth) throw new HttpError.BadRequest(Text`
			Available methods:
			${Object.getOwnPropertyNames(mod).sort().join(', ')}
		`);
		if (!schema) {
			throw new HttpError.BadRequest(`Internal api method ${apiStr}`);
		}
		if (!site && !mod.$global && !schema.$global) {
			throw new HttpError.BadRequest(`API method ${apiStr} expects a site`);
		}
		return [schema, inst, meth];
	}

	async run(req = {}, command, data = {}) {
		const { app } = this;
		const [schema, mod, meth] = this.getService(req, command);
		data = mergeRecursive({}, data);
		Log.api("run %s:\n%O", command, data);
		if (schema.properties) {
			try {
				this.validate(schema, data, meth);
			} catch (err) {
				if (err.name == "BadRequestError") {
					err.data = {
						method: command,
						message: err.message
					};
					err.content = await this.run(req, 'help.doc', { command, schema });
				}
				throw err;
			}
		}
		// start a transaction on set trx object on site
		let hadTrx = false;
		const { locals = { } } = req.res || { };

		if (req.trx) {
			hadTrx = true;
		} else {
			req.trx = await transaction.start(app.database.tenant(locals.tenant));
			req.trx.req = req;
		}
		Object.assign(req, { Block, Href, ref, val, raw, fun });

		const args = [req, data];

		try {
			const obj = await meth.apply(mod, args);
			if (!hadTrx && req.trx && !req.trx.isCompleted()) {
				await req.trx.commit();
			}
			return obj;
		} catch(err) {
			Log.api("error %s:\n%O", command, err);
			if (!hadTrx && !req.trx.isCompleted()) {
				await req.trx.rollback();
			}
			if (!err.method) err.method = command;
			throw err;
		} finally {
			if (req.trx && req.trx.isCompleted()) {
				if (hadTrx) {
					req.trx = await transaction.start(app.database.tenant(locals.tenant));
				} else {
					delete req.trx;
				}
			}
		}
	}

	send(res, obj) {
		const { req } = res;
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
			const code = Number.parseInt(obj.status);
			if (code < 200 || code >= 600 || Number.isNaN(code)) {
				console.error("Unknown error code", obj.status);
				res.status(500);
			} else {
				res.status(code);
			}
			delete obj.status;
		}

		obj = this.app.responseFilter.run(req, obj);
		if (obj.item && !obj.item.type) {
			// 401 Unauthorized: missing or bad authentication
			// 403 Forbidden: authenticated but not authorized
			res.status(req.user.id ? 403 : 401);
		}
		if (req.granted) res.set('X-Granted', 1);

		if (req.types.size > 0) obj.types = Array.from(req.types);

		res.json(obj);
	}

	filter(req, schema, block) {
		if (schema.upgrade) for (const [src, dst] of Object.entries(schema.upgrade)) {
			const val = jsonPath.get(block, src);
			if (val !== undefined) {
				jsonPath.set(block, dst, val);
				jsonPath.unSet(block, src);
			}
		}
		if (schema.templates) {
			block.expr = mergeExpressions(block.expr ?? {}, schema.templates, block);
			if (Object.isEmpty(block.expr)) block.expr = null;
		}
	}

};
