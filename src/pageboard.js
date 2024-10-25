require('./polyfills');

// exceptional but so natural
global.HttpError = require('http-errors');
global.Text = require('outdent');
global.Log = require('./log')('pageboard');

const util = require('node:util');
const Path = require('node:path');
const { promises: fs, readFileSync, createWriteStream } = require('node:fs');
const xdg = require('xdg-basedir');
const toml = require('toml');
const express = require('express');
const ServiceRouter = require('./service-router');

util.inspect.defaultOptions.depth = 10;

const cli = require('./cli');
const { mergeRecursive, init: initUtils } = require('./utils');

const pkgApp = JSON.parse(
	readFileSync(Path.join(__dirname, '..', 'package.json'))
);

module.exports = class Pageboard {
	#server;
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
			"@pageboard/core",
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
		log: {
			format: ':method :status :time :size :site :url',
		},
		server: {
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

	async run(command, data, { site: id, grant } = {}) {
		const req = Object.setPrototypeOf({
			headers: {},
			params: {},
			_method: 'get'
		}, express.request);
		const res = Object.setPrototypeOf({
			headersSent: true,
			headers: {},
			locals: {},
			writeHead() {}
		}, express.response);
		res.getHeader = res.setHeader = () => { };
		res.attachment = filename => {
			return createWriteStream(filename);
		};
		this.domains.extendRequest(req, res, this);

		req.res.locals.tenant = this.opts.database.tenant;
		req.user ??= { grants: [] };
		req.locks ??= [];
		if (grant) req.user.grants.push(grant);
		if (id) {
			let site = this.domains.siteById[id];
			if (!site) {
				site = this.domains.siteById[id] = await req.run(
					'install.domain',
					await req.run('site.get', { id })
				);
				if (site.data.domains?.length > 0) {
					site.$url = new URL(`https://${site.data.domains[0]}`);
				} else {
					site.$url = new URL(`https://${id}.${req.opts.domain}:${req.opts.port}`);
				}
			}
			req.site = site;
		} else {
			req.site = { id: "*", data: {} };
			req.site = await req.run('install.pack');
		}
		try {
			return req.run(command, data);
		} catch (err) {
			console.error(command, err);
			throw err;
		} finally {
			req.res.writeHead(); // triggers finitions
		}
	}

	#loadPlugin(path, sub) {
		try {
			const Mod = require(path);
			const pkg = path.startsWith('/') ? {} : require(Path.join(path, 'package.json'));
			if (!this.opts[Mod.name]) this.opts[Mod.name] = {};
			const opts = this.opts[Mod.name];
			if (opts.version) throw new Error(`${Mod.name}.version is a reserved option`);
			if (pkg.version) opts.version = pkg.version;
			const plugin = new Mod(this, opts);
			if (Mod.name && !sub) this[Mod.name] = plugin;
			this.#plugins.push(plugin);
			if (Mod.plugins) this.#loadPlugins(Mod, true);
		} catch (err) {
			console.error("Error loading plugin", path, sub);
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
		const server = this.#server = this.#createServer();

		await initUtils();

		this.#plugins = [];
		this.#loadPlugins(this.opts);
		await this.#initDirs(this.dirs);

		this.#plugins.sort((a, b) => {
			return a.constructor.priority || 0 - b.constructor.priority || 0;
		});

		for (const plugin of this.#plugins) {
			if (typeof plugin.elements == "function") Object.assign(
				this.elements, await plugin.elements(this.elements)
			);
		}
		this.#initServices();
		for (const plugin of this.#plugins) {
			if (plugin.init) await plugin.init();
		}

		if (this.opts.cli) return;

		process.title = "pageboard@" + this.version;

		const siteRouter = await this.#initPlugins("site");
		siteRouter.use((err, req, res, next) => {
			const code = getCode(err);
			if ((this.dev || code >= 500) && code != 503) {
				console.error(err);
			}
			res.sendStatus(code);
		});
		server.use("/", siteRouter);

		const fileRouter = await this.#initPlugins("file");
		fileRouter.get("/*", (req, res, next) => {
			next(new HttpError.NotFound(req.path));
		});
		fileRouter.use((err, req, res, next) => {
			const code = getCode(err);
			if ((this.dev || code >= 500) && code != 404) {
				console.error(err);
			}
			if (code >= 400) {
				this.log.manual(req);
			}
			res.sendStatus(code);
		});
		server.use((req, res, next) => {
			const pref = '/.uploads/';
			if (req.url.startsWith(pref)) {
				req.url = "/@file/share/" + req.url.slice(pref.length);
			} else if (/^\/@file\/\d{4}-\d{2}\//.test(req.url)) {
				req.url = "/@file/share/" + req.url.slice("/@file/".length);
			}
			next();
		});
		server.use('/@file', fileRouter);

		const apiRouter = await this.#initPlugins("api");
		apiRouter.use((req, res, next) => {
			next(new HttpError.NotFound("Unknown api url: " + req.url));
		});
		apiRouter.use((err, req, res, next) => {
			const code = getCode(err);
			if (this.dev) console.error(err);
			const obj = {
				item: {
					type: 'error',
					data: Object.assign({
						method: err.method,
						message: err.message
					}, err.data),
					content: (err.method ? `${err.method}: ` : '') + (err.content ?? err.toString())
				}
			};
			if (!res.headersSent) res.status(code).json(obj);
		});
		server.use('/@api', apiRouter);

		const viewRouter = await this.#initPlugins("view");
		viewRouter.use((err, req, res, next) => {
			const code = getCode(err);
			if ((this.dev || code >= 500) && code != 404) {
				console.error(err);
			}
			if (!res.headersSent) {
				res.status(code);
			}
			res.end(err.toString());
		});
		server.use('/', viewRouter);
		await this.#start();
	}

	#createServer() {
		const server = express();
		server.set("env", this.dev ? 'development' : 'production');
		if (this.dev) server.set('json spaces', 2);
		server.disable('x-powered-by');
		server.enable('trust proxy');
		server.enable('catch async errors');
		server.use((req, res, next) => {
			res.set({
				'Referrer-Policy': 'strict-origin-when-cross-origin',
				'X-XSS-Protection': '1;mode=block',
				'X-Frame-Options': 'sameorigin',
				'X-Content-Type-Options': 'nosniff'
			});
			next();
		});
		return server;
	}

	async #start() {
		const server = this.#server;

		await new Promise(resolve => {
			server.listen(this.opts.server.port, resolve);
		});
		console.info(`port:\t${this.opts.server.port}`);
	}

	async stop() {
		await this.#server.shutdown();
	}

	async #initDirs(dirs) {
		for (const dir of Object.values(dirs)) {
			Log.core("init dir", dir);
			await fs.mkdir(dir, { recursive: true });
		}
	}

	async #initPlugins(group) {
		const router = new express.Router();
		ServiceRouter(group, router);
		const meth = group + `Routes`;
		for (const plugin of this.#plugins) {
			await plugin[meth]?.(router);
		}
		return router;
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
