const { transaction, fn: fun, val, ref, raw } = require('@kapouer/objection');
const Path = require('node:path');

const Packager = require.lazy('./lib/packager');
const Validation = require('./lib/validation');

const Href = require('./models/href');
const Block = require('./models/block');

const { mergeRecursive } = require('../../src/utils');
const ResponseFilter = require('./lib/filter');

module.exports = class ApiModule {
	static name = 'api';
	static priority = -1;
	static plugins = [
		'help', 'user', 'site', 'archive', 'settings', 'page', 'links',
		'block', 'href', 'reservation', 'translate', 'redirect', 'apis'
	].map(name => Path.join(__dirname, 'services', name));

	#packager;
	#validation;
	#responseFilter = new ResponseFilter();

	constructor(app) {
		this.app = app;
		const self = this;

		Href.createValidator = function() {
			return self.validation.createValidator(this);
		};

		Block.createValidator = function() {
			return self.validation.createValidator(this);
		};
	}

	registerFilter(service) {
		this.#responseFilter.register(service);
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
		// api depends on site files, that tag is invalidated in cache install
		app.get("/.well-known/api.json", req => ({
			location: req.site.$pkg.bundles.get('services').scripts[0]
		}));
		app.get("/@api", req => ({
			location: "/.well-known/api"
		}));
	}

	async install(block, pkg) {
		if (!this.#packager) this.#packager = new Packager(this.app, Block);
		const site = await this.#packager.run(block, pkg);
		return site;
	}

	async makeBundles(site, pkg) {
		await this.#packager.makeSchemas(site, pkg);
		return this.#packager.makeBundles(site, pkg);
	}

	check(req, data) {
		try {
			this.validation.validate(req, data);
			return true;
		} catch {
			return false;
		}
	}

	validate(req, data) {
		this.validation.validate(req, data);
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
		if (req.res) {
			const { $tags = ['data-:site'] } = schema;
			app.cache.tag(...$tags)(req, req.res, () => { });
		}
		if (schema.$lock != null && schema.$lock !== true) {
			if (req.locked?.(schema.$lock)) {
				if (req.user?.grants?.length == 0) {
					throw new HttpError.Unauthorized(schema.$lock);
				} else {
					throw new HttpError.Forbidden(schema.$lock);
				}
			}
		}

		this.validate(req, data);

		// start a transaction on set trx object on site
		let hadTrx = false;
		req.genTrx ??= (async function (req) {
			const { locals = {} } = req.res || {};
			return transaction.start(app.database.tenant(locals.tenant));
		}).bind(this, req);

		if (req.trx?.isCompleted()) {
			req.trx = null;
		}
		let hadRead = false;
		let hadWrite = false;

		if (req.trx) {
			hadTrx = true;
		} else if (schema.$action) {
			req.trx = await req.genTrx();
			req.trx.req = req; // needed by objection hooks
			req.trx.on('query', data => {
				if (!data.method) {
					if (!data.sql || /^(COMMIT|ROLLBACK);?$/.test(data.sql) == false) {
						console.warn("unknown", data);
					}
				} else if (data.method == "select") {
					hadRead = true;
				} else if (['insert', 'update', 'delete'].includes(data.method)) {
					hadWrite = true;
				}
			});
		}
		Object.assign(req, { Block, Href, ref, val, raw, fun });

		try {
			const obj = await service(req, data.parameters);
			if (!hadTrx && req.trx && !req.trx.isCompleted()) {
				await req.trx.commit();
			}
			if (!schema.$private) {
				return this.#responseFilter.run(req, obj);
			} else {
				return obj;
			}
		} catch(err) {
			Log.api("error %s:\n%O", method, err);
			if (!hadTrx && req.trx && !req.trx.isCompleted()) {
				await req.trx.rollback();
			}
			if (!err.method) err.method = method;
			throw err;
		} finally {
			if (req.trx) {
				if (hadTrx) {
					// regenerate completed trx
					if (req.trx.isCompleted()) req.trx = await req.genTrx();
				} else if (hadWrite) {
					if (schema.$action != "write") {
						console.warn(method, "had write transaction with $action", schema.$action);
					}
				} else if (hadRead && !schema.$action) {
					console.warn(method, "had read transaction without $action");
				}
			}
		}
	}

};
