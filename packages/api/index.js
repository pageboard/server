const { transaction, fn: fun, val, ref, raw } = require('objection');
const Path = require('node:path');

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
		'help', 'user', 'site', 'archive', 'settings', 'page', 'links',
		'block', 'href', 'reservation', 'translate', 'apis'
	].map(name => Path.join(__dirname, 'services', name));

	#packager;
	#validation;

	constructor(app) {
		this.app = app;

		Href.createValidator = () => {
			return this.validation.createValidator();
		};

		Block.createValidator = () => {
			return this.validation.createValidator();
		};
	}

	get validation() {
		if (!this.#validation) {
			const elements = {
				$id: '/elements',
				type: 'object',
				definitions: {},
				required: ['type'],
				discriminator: { propertyName: 'type' },
				oneOf: []
			};
			for (const [name, el] of Object.entries(this.app.elements)) {
				el.name = name;
				el.contents = Block.normalizeContentSpec(el.contents);
				elements.definitions[name] = Block.elementToSchema(el);
				elements.oneOf.push({ $ref: `#/definitions/${name}` });
			}

			const services = {
				$id: '/services',
				type: 'object',
				definitions: this.app.servicesDefinitions,
				required: ['method'],
				discriminator: { propertyName: "method" },
				oneOf: Object.keys(this.app.servicesDefinitions).map(name => ({
					$ref: '#/definitions/' + name
				}))
			};
			this.#validation = new Validation(services, elements);
		}
		return this.#validation;
	}

	apiRoutes(app) {
		app.responseFilter.register(this);
		// api depends on site files, that tag is invalidated in cache install
		app.get("/.well-known/api.json", req => ({
			location: req.site.$pkg.bundles.get('services').scripts[0]
		}));
		app.get("/.api", req => ({
			location: "/.well-known/api"
		}));
	}

	async install(...args) {
		if (!this.#packager) this.#packager = new Packager(this.app, Block);
		return this.#packager.run(...args);
	}

	async makeBundles(site, pkg) {
		await this.#packager.makeSchemas(site, pkg);
		return this.#packager.makeBundles(site, pkg);
	}

	check(data, site) {
		try {
			this.validation.validate(data, site);
			return true;
		} catch (err) {
			return false;
		}
	}

	validate(data, site) {
		this.validation.validate(data, site);
		return data;
	}

	getService(apiStr) {
		const [modName, funName] = (apiStr || "").split('.');
		const mod = this.app.services[modName];
		if (!modName || !mod) {
			throw new HttpError.BadRequest(Text`
				${modName} module not found:
				${Object.keys(this.app.services).sort().join(', ')}
			`);
		}
		const inst = this.app[modName];
		if (!funName || !inst[funName]) throw new HttpError.BadRequest(Text`
			${funName} method not found:
			${Object.getOwnPropertyNames(mod).sort().join(', ')}
		`);
		return [
			this.app.servicesDefinitions[apiStr],
			(req, data) => inst[funName](req, data)
		];
	}

	async run(req = {}, method, parameters = {}) {
		const { app } = this;
		const [schema, service] = this.getService(method);
		Log.api("run %s:\n%O", method, parameters);
		const data = {
			method,
			parameters: mergeRecursive({}, parameters)
		};
		if (!schema.$global && !req.site) {
			throw new HttpError.BadRequest(method + ' expects site to be defined');
		}
		if (schema.$cache != null && req.res) {
			if (schema.$cache === false) {
				app.cache.disable(req, req.res, () => { });
			} else if (typeof schema.$cache == "string") {
				app.cache.for(schema.$cache)(req, req.res, () => { });
			}
		}
		if (schema.$tags && req.res) {
			console.log("tag cache", schema.$tags);
			app.cache.tag(...schema.$tags)(req, req.res, () => { });
		}
		if (schema.$lock != null && schema.$lock !== true) {
			if (req.locked?.(schema.$lock)) {
				return {
					status: req.user?.grants?.length == 0 ? 401 : 403,
					locks: req.locks
				};
			}
		}
		this.validate(data, req.site);

		// start a transaction on set trx object on site
		let hadTrx = false;
		const { locals = {} } = req.res || {};
		if (req.trx?.isCompleted()) {
			req.trx = null;
		}

		if (req.trx) {
			hadTrx = true;
		} else {
			req.trx = await transaction.start(app.database.tenant(locals.tenant));
			req.trx.req = req; // needed by objection hooks
		}
		Object.assign(req, { Block, Href, ref, val, raw, fun });

		try {
			const obj = await service(req, data.parameters);
			if (!hadTrx && req.trx && !req.trx.isCompleted()) {
				await req.trx.commit();
			}
			return obj;
		} catch(err) {
			Log.api("error %s:\n%O", method, err);
			if (!hadTrx && !req.trx.isCompleted()) {
				await req.trx.rollback();
			}
			if (!err.method) err.method = method;
			throw err;
		} finally {
			if (req.trx && req.trx.isCompleted()) {
				if (hadTrx) {
					req.trx = await transaction.start(app.database.tenant(locals.tenant));
				} else {
					// top-lost run call
					delete req.trx;
					req.postTryProcess();
				}
			}
		}
	}

	send(req, obj) {
		const { res } = req;
		if (obj == null) {
			res.sendStatus(204);
			return;
		}
		if (typeof obj == "string") {
			if (!res.get('Content-Type')) res.type('text/plain');
			res.send(obj);
			return;
		}
		if (typeof obj != "object") {
			// eslint-disable-next-line no-console
			console.trace("app.send expects an object, got", obj);
			obj = {};
		}
		if (obj.cookies) {
			const cookieParams = {
				httpOnly: true,
				sameSite: true,
				secure: req.site.$url.protocol == "https:",
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
		if (req.user.grants.length) obj.grants = Object.fromEntries(
			req.user.grants.map(grant => [grant, true])
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
		if (obj.location) {
			res.redirect(obj.location);
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
