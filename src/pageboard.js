require('./polyfills');
const importLazy = require('import-lazy');
Object.getPrototypeOf(require).lazy = function(str) {
	return importLazy(this)(str);
};

const util = require('node:util');
const Path = require('node:path');
const express = require.lazy('express');
const bodyParser = require.lazy('body-parser');
const morgan = require.lazy('morgan');
const pad = require.lazy('pad');
const http = require.lazy('node:http');
const { promises: fs, readFileSync, createWriteStream } = require('node:fs');
const { once } = require.lazy('node:events');
const xdg = require('xdg-basedir');
const toml = require('toml');

util.inspect.defaultOptions.depth = 10;

const cli = require.lazy('./cli');
const Domains = require.lazy('./domains');
const { mergeRecursive, init: initUtils, unflatten } = require('./utils');
const Installer = require('./installer');

// exceptional but so natural
global.HttpError = require('http-errors');
global.Text = require('outdent');
global.Log = require('./log')('pageboard');

const pkgApp = JSON.parse(
	readFileSync(Path.join(__dirname, '..', 'package.json'))
);

module.exports = class Pageboard {
	#server;
	#installer;
	#plugins;
	elements = {};
	services = {};
	servicesDefinitions = {};
	cwd = process.cwd();

	static parse(args) {
		return cli.parse(args);
	}

	static defaults = {
		name: pkgApp.name,
		version: pkgApp.version,
		upstream: null,
		verbose: false,
		installer: {
			bin: 'npm',
			timeout: 60000
		},
		dirs: {
			app: Path.dirname(__dirname),
			config: Path.join(xdg.config, pkgApp.name),
			cache: Path.join(xdg.cache, pkgApp.name),
			data: Path.join(xdg.data, pkgApp.name),
			tmp: Path.join(xdg.data, '../tmp', pkgApp.name)
		},
		plugins: [
			"@pageboard/ai",
			"@pageboard/api",
			"@pageboard/auth",
			"@pageboard/cache",
			"@pageboard/db",
			"@pageboard/git",
			"@pageboard/image",
			"@pageboard/inspector",
			"@pageboard/mail",
			"@pageboard/polyfill",
			"@pageboard/prerender",
			"@pageboard/print",
			"@pageboard/upload",
			"@pageboard/statics"
		],
		server: {
			log: ':method :status :time :size :site :url',
			port: 3000
		},
		commons: {},
		upstreams: {},
		database: {
			tenant: 'current'
		}
	};

	constructor(opts = {}) {
		if (opts.config === undefined) {
			opts.config = Path.join(Pageboard.defaults.dirs.config, 'config.toml');
		}

		// TODO check schema of toml
		const fileOpts = opts.config ? toml.parse(readFileSync(opts.config)) : {};
		opts = mergeRecursive({}, Pageboard.defaults, fileOpts, opts);

		if (!opts.verbose) {
			console.info = () => { };
		}

		const upstream = opts.upstreams[opts.version];
		if (upstream) opts.server.port = upstream.split(':').pop();
		else throw new Error("Missing configuration: upstreams." + opts.version);

		opts.installer.timeout = parseInt(opts.installer.timeout);

		// app direct properties
		for (const key of ['name', 'version', 'dirs']) {
			this[key] = opts[key];
			delete opts[key];
		}
		this.dev = !opts.cache?.enable;
		this.opts = opts;
	}

	async run(command, data, { site, grant } = {}) {
		const req = Object.setPrototypeOf({
			headers: {},
			params: {}
		}, express.request);
		req.res = Object.setPrototypeOf({
			headersSent: true,
			locals: {},
			writeHead() {}
		}, express.response);
		req.res.getHeader = req.res.setHeader = () => { };
		req.res.attachment = filename => {
			return createWriteStream(filename);
		};
		this.domains.extendRequest(req, this);

		req.res.locals.tenant = this.opts.database.tenant;
		req.user ??= { grants: [] };
		req.locks ??= [];
		if (grant) req.user.grants.push(grant);
		if (site) {
			let siteInst = this.domains.siteById[site];
			if (!siteInst) {
				siteInst = this.domains.siteById[site] = await this.install(
					await this.api.run(req, 'site.get', {
						id: site
					})
				);
				if (siteInst.data.domains?.length > 0) {
					siteInst.$url = new URL(`https://${siteInst.data.domains[0]}`);
				} else {
					siteInst.$url = new URL(`https://${site}.${req.opts.domain}:${req.opts.port}`);
				}
			}
			req.site = siteInst;
		} else {
			await this.api.install({ id: "*", data: {} });
		}
		try {
			return this.api.run(req, command, data);
		} finally {
			req.res.writeHead(); // triggers finitions
		}
	}

	#loadPlugin(path, sub) {
		try {
			const Mod = require(path);
			if (!this.opts[Mod.name]) this.opts[Mod.name] = {};
			const opts = this.opts[Mod.name];
			const plugin = new Mod(this, opts);
			if (Mod.name && !sub) this[Mod.name] = plugin;
			this.#plugins.push(plugin);
			if (Mod.plugins) this.#loadPlugins(Mod, true);
		} catch (err) {
			console.error("Error loading plugin", path);
			throw err;
		}
	}

	#loadPlugins({ plugins }) {
		if (!plugins) return;
		for (const path of plugins) {
			this.#loadPlugin(path);
		}
	}

	async init() {
		const { opts } = this;

		const server = this.#server = this.#createServer();
		this.#installer = new Installer(this, opts.installer);

		await initUtils();

		this.#plugins = [];
		this.#loadPlugins(this.opts);
		await this.#initDirs(this.dirs);

		this.#plugins.sort((a, b) => {
			return a.constructor.priority || 0 - b.constructor.priority || 0;
		});

		this.domains = new Domains(this, opts);
		this.domains.routes(this, server);
		server.use((err, req, res, next) =>
			this.#domainsError(err, req, res, next)
		);

		this.#initServices();
		await this.#initPlugins();

		if (this.opts.cli) return;

		process.title = "pageboard@" + this.version;

		await this.#initLog();

		// call plugins#file
		await this.#initPlugins('file');
		server.use((err, req, res, next) =>
			this.#filesError(err, req, res, next)
		);
		server.use((req, res, next) => this.log(req, res, next));

		// call plugins#service
		const tenantsLen = Object.keys(this.opts.database.url).length - 1;
		server.get('/@api/*',
			this.cache.tag('app-:site'),
			this.cache.tag('db-:tenant').for(`${tenantsLen}day`)
		);
		await this.#initPlugins('api');
		server.use(req => {
			if (req.url.startsWith('/@api/')) {
				throw new HttpError.NotFound("Unknown api url");
			}
		});
		server.use((err, req, res, next) =>
			this.#servicesError(err, req, res, next)
		);

		// call plugins#view
		await this.#initPlugins('view');

		server.use((err, req, res, next) =>
			this.#viewsError(err, req, res, next)
		);
		await this.#start();
	}

	#createServer() {
		const server = require('./express-async')(express)();
		server.set("env", this.dev ? 'development' : 'production');
		if (this.dev) server.set('json spaces', 2);
		server.disable('x-powered-by');
		server.enable('trust proxy');
		server.use((req, res) => {
			const headers = {
				'Referrer-Policy': 'strict-origin-when-cross-origin',
				'X-XSS-Protection': '1;mode=block',
				'X-Frame-Options': 'sameorigin',
				'X-Content-Type-Options': 'nosniff'
			};
			res.set(headers);
		});
		return server;
	}

	use(handler) {
		this.#server.use(handler);
	}

	get(route, handler) {
		this.#server.get(
			route,
			async req => {
				if (typeof handler == "string") {
					const apiStr = handler;
					handler = req => req.run(apiStr, unflatten(req.query));
				}
				const data = await handler(req);
				this.send(req, data);
			}
		);
	}

	post(route, handler) {
		this.#server.post(
			route,
			bodyParser.json({
				limit: '1000kb',
				verify(req, res, buf) {
					req.buffer = buf;
				}
			}),
			bodyParser.urlencoded({ extended: false, limit: '100kb' }),
			async req => {
				if (typeof handler == "string") {
					const apiStr = handler;
					handler = req => req.run(apiStr, unflatten(req.body));
				}
				const data = await handler(req);
				this.send(req, data);
			}
		);
	}

	send(req, obj) {
		const { res } = req;
		if (obj == null) {
			res.sendStatus(204);
			return;
		}
		if (typeof obj == "string" || Buffer.isBuffer(obj)) {
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
		if (req.user.grants.length) {
			res.set('X-Pageboard-Grants', req.user.grants.join(','));
		}
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
		if (obj.item && !obj.item.type) {
			// 401 Unauthorized: missing or bad authentication
			// 403 Forbidden: authenticated but not authorized
			res.status(req.user.id ? 403 : 401);
		}
		if (req.granted) {
			res.set('X-Pageboard-Granted', 1);
		}

		if (req.types.size > 0) {
			res.set('X-Pageboard-Elements', Array.from(req.types).join(','));
		}

		res.json(obj);
	}

	async install(block) {
		this.domains.hold(block);
		try {
			// get configured pkg with paths to elements definitions
			const pkg = await this.#installer.install(block, this);
			// parse and normalize all elements and build site schema
			const site = await this.api.install(block, pkg);
			// mount paths
			await this.statics.install(site, pkg);
			// build js, css, and compile schema validators
			await this.api.makeBundles(site, pkg);
			await this.auth.install(site);
			if (this.dev == false) await this.#installer.clean(site, pkg);
			site.data.server = this.version;
			this.domains.release(site);
			await this.cache.install(site);
			return site;
		} catch (err) {
			if (block.url) this.domains.error(block, err);
			if (this.dev) console.error(err);
			throw err;
		}
	}

	async #start() {
		const server = http.createServer(this.#server);
		server.listen(this.opts.server.port);
		this.#server.stop = () => server[Symbol.asyncDispose]();
		await once(server, 'listening');
		console.info(`port:\t${this.opts.server.port}`);
	}

	async stop() {
		await this.#server.stop();
	}

	async #initDirs(dirs) {
		for (const dir of Object.values(dirs)) {
			Log.core("init dir", dir);
			await fs.mkdir(dir, { recursive: true });
		}
	}

	async #initPlugins(type) {
		const server = this.#server;
		const init = type ? `${type}Routes` : 'init';

		if (!type) for (const plugin of this.#plugins) {
			if (typeof plugin.elements == "function") Object.assign(
				this.elements, await plugin.elements()
			);
		}

		for (const plugin of this.#plugins) {
			if (!plugin[init]) continue;
			await plugin[init](this, server);
		}
	}

	async #initServices() {
		for (const plugin of this.#plugins) {
			const { constructor } = plugin;
			const { name } = constructor;
			const { services } = this;
			const service = services[name] ?? {};
			let defined = false;
			for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(plugin))) {
				if (key == 'constructor') continue;
				const desc = constructor[key];
				if (!desc) continue;
				const func = plugin[key];
				if (typeof func != "function") continue;
				service[key] = desc;
				desc.title = `${name}: ${desc.title}`;
				defined = true;
				const method = `${name}.${key}`;
				const schema = {
					title: desc.title,
					type: 'object',
					properties: {
						method: {
							title: 'Method',
							const: method
						},
						parameters: {
							...desc,
							title: 'Parameters'
						},
						request: {
							title: 'Request Map',
							type: 'object',
							nullable: true
						},
						response: {
							title: 'Response Map',
							type: 'object',
							nullable: true
						}
					}
				};
				if (desc.$global == null && constructor.$global != null) {
					desc.$global = constructor.$global;
				}
				for (const name of ['$cache', '$tags', '$private', '$action', '$global', '$lock', 'title', 'description']) {
					if (desc[name] != null) {
						schema[name] = desc[name];
						delete desc[name];
					}
				}
				this.servicesDefinitions[method] = schema;
			}
			if (defined) {
				this.api.registerFilter(service);
				if (!services[name]) services[name] = service;
			}
		}
	}

	async #initLog() {
		const { default: prettyBytes } = await import('pretty-bytes');
		morgan.token('method', (req, res) => {
			return pad((req.call('prerender.prerendering') ? '*' : '') + req.method, 4);
		});
		morgan.token('status', (req, res) => {
			return pad(3, res.statusCode);
		});
		morgan.token('time', (req, res) => {
			const ms = morgan['response-time'](req, res, 0);
			if (ms) return pad(4, ms) + 'ms';
			else return pad(6, '');
		});
		morgan.token('type', (req, res) => {
			return pad(4, (res.get('Content-Type') || '-').split(';').shift().split('/').pop());
		});
		morgan.token('size', (req, res) => {
			const len = parseInt(res.get('Content-Length'));
			return pad(6, (len && prettyBytes(len) || '0 B').replaceAll(' ', ''));
		});
		morgan.token('site', (req, res) => {
			return pad(res.locals.site && res.locals.site.substring(0, 8) || "-", 8);
		});

		this.log = morgan(this.opts.server.log, {
			skip: function (req, res) {
				return false;
			}
		});
	}

	#domainsError(err, req, res, next) {
		const code = getCode(err);
		if ((this.dev || code >= 500) && code != 503) {
			console.error(err);
		}
		res.sendStatus(code);
	}

	#servicesError(err, req, res, next) {
		const code = getCode(err);
		if (this.dev) console.error(err);
		const obj = {
			status: err.statusCode || err.status || err.code || 400,
			item: {
				type: 'error',
				data: Object.assign({
					method: err.method,
					message: err.message
				}, err.data),
				content: (err.method ? `${err.method}: ` : '') + (err.content ?? err.toString())
			}
		};
		if (!res.headersSent) res.status(code).send(obj);
	}

	#filesError(err, req, res, next) {
		const code = getCode(err);
		if ((this.dev || code >= 500) && code != 404) {
			console.error(err);
		}
		if (code >= 400) {
			this.log(req, res, () => {
				res.status(code);
				res.send("");
			});
		} else {
			res.sendStatus(code);
		}
	}

	#viewsError(err, req, res, next) {
		const code = getCode(err);
		if ((this.dev || code >= 500) && code != 404) {
			console.error(err);
		}
		if (!res.headersSent) {
			res.status(code);
		}
		res.end(err.toString());
	}
};


function getCode(err) {
	const fullCode = err.statusCode || err.status || err.code;
	let code = parseInt(fullCode);
	if (Number.isNaN(code) || code < 200 || code >= 600) {
		err.code = fullCode;
		code = 500;
	}
	return code;
}
