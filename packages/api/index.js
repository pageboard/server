const { transaction, fn: fun, val, ref, raw } = require('@kapouer/objection');
const Path = require('node:path');
const Validation = require('./lib/validation');

const Href = require('./models/href');
const Block = require('./models/block');

const ResponseFilter = require('./lib/filter');

const { mergeRecursive } = require('../../src/utils');

module.exports = class ApiModule {
	static name = 'api';
	static priority = -1;
	static plugins = [
		'help', 'user', 'site', 'archive', 'settings', 'page', 'links',
		'block', 'href', 'reservation', 'translate', 'redirect', 'apis',
		'proxy', 'stat'
	].map(name => Path.join(__dirname, 'services', name));

	#validation;

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

	apiRoutes(router) {
		const tenantsLen = Object.keys(this.app.opts.database.url).length - 1;
		router.get('/{*path}',
			this.app.cache.tag('app-:site'),
			this.app.cache.tag('db-:tenant').for(`${tenantsLen}day`)
		);
		// api depends on site files, that tag is invalidated in cache install
		// TODO eventually all api will be dynamic
		// and called through query.get/post
		// several blocking points:
		// - upload files support
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
		const [schema, service] = typeof method == "string"
			? this.getService(method) : [null, method];
		const data = {
			method: typeof method == "string" ? method : undefined,
			parameters: mergeRecursive({}, parameters)
		};
		if (schema) {
			Log.api("run %s:\n%O", method, parameters);
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

			this.validate(req, data);
		}

		const sql = req.sql ??= { ref, val, raw, fun, Block, Href };

		sql.genTrx ??= (async function (req) {
			const { locals = {} } = req.res || {};
			return transaction.start(app.database.tenant(locals.tenant));
		}).bind(this, req);

		if (sql.trx?.isCompleted()) {
			sql.trx = null;
		}
		const hadTrx = Boolean(sql.trx);

		let hadRead = false;
		let hadWrite = false;
		if (!hadTrx && (!schema || schema?.$action)) {
			sql.trx = await sql.genTrx();
			sql.trx.req = req; // needed by objection hooks
			sql.trx.on('query', data => {
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

		try {
			const obj = await service(req, data.parameters);
			if (!hadTrx && sql.trx && !sql.trx.isCompleted()) {
				await sql.trx.commit();
			}
			return obj;
		} catch(err) {
			Log.api("error %s:\n%O", method, err);
			if (!hadTrx && sql.trx && !sql.trx.isCompleted()) {
				await sql.trx.rollback();
			}
			if (!schema?.$action && err.message?.startsWith("no database connection")) {
				console.warn(method, "schema might need $action = read|write");
			}
			if (!err.method) err.method = method;
			throw err;
		} finally {
			if (sql.trx && !hadTrx) {
				if (sql.trx.isCompleted()) {
					sql.trx = null;
				}
				if (hadWrite) {
					if (schema && schema.$action != "write") {
						console.warn(method, "had write transaction with $action", schema.$action);
					}
				} else if (hadRead && schema && !schema.$action) {
					console.warn(method, "had read transaction without $action");
				}
			}
		}
	}

	#filter = new ResponseFilter();

	register(service) {
		this.#filter.register(service);
	}

	filter(req, obj) {
		return this.#filter.run(req, obj);
	}

};
