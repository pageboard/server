const { transaction } = require('objection');
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
		const fun = inst[funName];
		if (!funName || !fun) throw new HttpError.BadRequest(Text`
			Available methods:
			${Object.getOwnPropertyNames(mod).sort().join(', ')}
		`);
		if (!schema) {
			throw new HttpError.BadRequest(`Internal api method ${apiStr}`);
		}
		if (!site && !mod.$global && !schema.$global) {
			throw new HttpError.BadRequest(`API method ${apiStr} expects a site`);
		}
		return [schema, inst, fun];
	}

	async run(req = {}, command, data = {}) {
		const { app } = this;
		const [schema, mod, fun] = this.getService(req, command);
		data = mergeRecursive({}, data);
		Log.api("run %s:\n%O", command, data);
		try {
			this.validate(schema, data, fun);
		} catch (err) {
			err.data = {
				method: command,
				messages: err.message
			};
			err.content = await this.run('help.doc', { command, schema });
			throw err;
		}
		// start a transaction on set trx object on site
		let hadTrx = false;
		const { locals = { } } = req.res || { };

		if (req.trx) {
			hadTrx = true;
		} else {
			req.trx = await transaction.start(app.database.tenant(locals.tenant));
			req.trx.req = req; // models hooks can call api
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

		if (obj.item || obj.items) {
			const { bundles, bundleMap } = req.site.$pkg;

			if (obj.item) fillTypes(obj.item, req.bundles);
			if (obj.items) fillTypes(obj.items, req.bundles);

			const usedRoots = new Map();
			for (const [type, conf] of req.bundles) {
				if (bundles[type]) {
					usedRoots.set(type, conf);
				} else {
					const rootSet = bundleMap.get(type);
					if (!rootSet) {
						console.warn("missing bundle for block type:", type);
						continue;
					}
					// ignore elements without bundles, or belonging to multiple roots
					if (rootSet.size != 1) continue;
					usedRoots.set(Array.from(rootSet).at(0), conf);
				}
			}
			const metas = [];
			if (obj.meta) {
				console.warn("obj.meta is set", obj.meta);
				metas.push([obj.meta, {}]);
				delete obj.meta;
			}
			for (const [root, conf] of usedRoots) {
				const { meta } = bundles[root];
				if (meta.dependencies) for (const dep of meta.dependencies) {
					metas.push([bundles[dep].meta, conf]);
				}
				metas.push([meta, conf]);
			}
			metas.sort(({ priority: a = 0 }, { priority: b = 0 }) => {
				if (a == b) return 0;
				else if (a > b) return 1;
				else return -1;
			});
			obj.metas = metas.map(([meta, conf]) => {
				const obj = {};
				for (const key of ['schemas', 'scripts', 'stylesheets', 'resources', 'priority']) if (meta[key]) {
					if (key == 'schemas' || conf.content) obj[key] = meta[key];
				}
				return obj;
			});
		}

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

function fillTypes(list, map) {
	if (!list) return map;
	if (!Array.isArray(list)) list = [list];
	for (const row of list) {
		if (row.type) {
			if (!map.has(row.type)) map.set(row.type, {});
			const conf = map.get(row.type);
			if (row.content != null) conf.content = true;
		}
		if (row.type == "binding" || row.type == "block_binding") {
			findTypeBinding(row.data.fill, map);
			findTypeBinding(row.data.attr, map);
		}
		if (row.parent) fillTypes(row.parent, map);
		if (row.child) fillTypes(row.child, map);
		if (row.parents) fillTypes(row.parents, map);
		if (row.children) fillTypes(row.children, map);
	}
	return map;
}


function findTypeBinding(str, map) {
	if (!str) return;
	const { groups: {
		type
	} } = /^schema:[.\w]+:(?<type>\w+)\./m.exec(str) ?? {
		groups: {}
	};
	if (type && !map.has(type)) map.set(type, {});
}
