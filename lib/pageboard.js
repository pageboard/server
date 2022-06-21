Object.isEmpty = function (obj) {
	if (obj == null) return true;
	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			return false;
		}
	}
	return JSON.stringify(obj) === JSON.stringify({});
};

const importLazy = require('import-lazy');
Object.getPrototypeOf(require).lazy = function(str) {
	return importLazy(this)(str);
};

const util = require('node:util');
const Path = require('node:path');
const express = require.lazy('express');
const morgan = require.lazy('morgan');
const pad = require.lazy('pad');
const prettyBytes = require.lazy('pretty-bytes');
const http = require.lazy('node:http');
const { promises: fs, readFileSync } = require('node:fs');
const { once } = require.lazy('node:events');
const xdg = require('xdg-basedir');
const toml = require('toml');

util.inspect.defaultOptions.depth = 10;

const cli = require.lazy('./cli');
const Domains = require.lazy('./domains');
const { mergeRecursive } = require('./utils');
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
	services = {};
	elements = [];
	directories = [];
	cwd = process.cwd();

	static parse(args) {
		return cli.parse(args);
	}

	static defaults = {
		name: pkgApp.name,
		version: pkgApp.version.split('.').slice(0, 2).join('.'),
		upstream: null,
		verbose: false,
		env: process.env.NODE_ENV || 'development',
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
			"@pageboard/api",
			"@pageboard/auth",
			"@pageboard/cache",
			"@pageboard/db",
			"@pageboard/github-webhook",
			"@pageboard/image",
			"@pageboard/inspector",
			"@pageboard/mail",
			"@pageboard/pdf",
			"@pageboard/prerender",
			"@pageboard/statics",
			"@pageboard/upload"
		],
		server: {
			log: ':method :status :time :size :site :url',
			port: 3000,
			start: false
		},
		commons: {},
		upstreams: {}
	};

	constructor(opts = {}) {
		if (opts.config === undefined) {
			opts.config = Path.join(Pageboard.defaults.dirs.config, 'config');
		}

		// TODO check schema of toml
		const fileOpts = opts.config ? toml.parse(readFileSync(opts.config)) : {};
		opts = mergeRecursive({}, Pageboard.defaults, fileOpts, opts);

		if (!opts.verbose) {
			console.info = () => { };
		}
		if (opts.cli == null) opts.cli = !opts.server?.start;

		opts.upstream = opts.upstreams[opts.version];
		if (opts.upstream) opts.server.port = opts.upstream.split(':').pop();

		opts.installer.timeout = parseInt(opts.installer.timeout);

		// all these become direct properties
		for (const key of ['name', 'version', 'env', 'dirs']) {
			this[key] = opts[key];
			delete opts[key];
		}
		this.opts = opts;
	}

	async #symlinkDir(name) {
		try {
			await fs.symlink(
				Path.join(this.dirs.data, name),
				Path.join(this.dirs.app, name)
			);
		} catch (err) {
			// pass
		}
	}

	async run(command, data, site) {
		const req = { res: {} };
		this.domains.extendRequest(req, this);
		if (site) {
			req.site = await this.install(
				await this.api.run(req, 'site.get', {
					id: site
				})
			);
		}
		return this.api.run(req, command, data);
	}

	async send(...args) {
		return this.api.send(...args);
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
		await this.#symlinkDir('sites');
		await this.#symlinkDir('uploads');
		await this.#symlinkDir('dumps');

		const { opts } = this;

		const server = this.#server = this.#createServer();
		this.#initLog();
		this.#installer = new Installer(this, opts.installer);

		this.#plugins = [];
		this.#loadPlugins(this.opts);
		await this.#initDirs(this.dirs);

		this.#plugins.sort((a, b) => {
			return a.constructor.priority || 0 - b.constructor.priority || 0;
		});

		this.domains = new Domains(this, opts);
		this.domains.routes(this, server);
		server.use((err, req, res, next) =>
			this.#domainsError(err, req, res, next));

		this.#initServices();

		if (!this.opts.server.start) return;

		// call plugins#file
		await this.#initPlugins('file');
		server.use((err, req, res, next) =>
			this.#filesError(err, req, res, next));
		server.use((req, res, next) => this.log(req, res, next));

		// call plugins#service
		await this.#initPlugins('api');
		server.use((req) => {
			if (req.url.startsWith('/.api/')) {
				throw new HttpError.NotFound("Unknown api url");
			}
		});
		server.use((err, req, res, next) =>
			this.#servicesError(err, req, res, next));

		// call plugins#view
		if (!this.cli) await this.#initPlugins('view');

		server.use((err, req, res, next) =>
			this.#viewsError(err, req, res, next));
		await this.#start();
	}

	#createServer() {
		const server = require('./express-async')(express)();
		// site-specific headers are built by page element and csp filter + prerender
		server.set("env", this.env);
		if (this.env == "development") {
			server.set('json spaces', 2);
		}
		server.disable('x-powered-by');
		server.enable('trust proxy');
		server.use((req, res) => {
			res.set({
				'Referrer-Policy': 'strict-origin-when-cross-origin',
				'X-XSS-Protection': '1;mode=block',
				'X-Frame-Options': 'sameorigin',
				'X-Content-Type-Options': 'nosniff'
			});
		});
		return server;
	}

	async install(block) {
		if (block.url) {
			this.domains.hold(block);
		}
		try {
			const pkg = await this.#installer.install(block, this);
			const site = await this.api.install(block, pkg);
			if (site.url) {
				await this.statics.install(site, pkg);
				await this.api.finishInstall(site, pkg);
			}
			await this.auth.install(site);
			if (site.url) await this.cache.install(site);
			if (this.env != "development") await this.#installer.clean(site, pkg);
			site.data.server = pkg.server || this.version;
			if (site.url) {
				this.domains.release(site);
			}
			return site;
		} catch (err) {
			if (block.url) this.domains.error(block, err);
			if (this.env == "development") console.error(err);
			throw err;
		}
	}

	async #start() {
		const server = http.createServer(this.#server);
		server.listen(this.opts.server.port);
		await once(server, 'listening');
		console.info(`port:\t${this.opts.server.port}`);
	}

	async #initDirs(dirs) {
		for (const [key, dir] of Object.entries(dirs)) {
			Log.core("init dir", dir);
			if (key == "tmp") {
				// clean up pageboard tmp dir
				await fs.rm(dir, { recursive: true });
			}
			await fs.mkdir(dir, { recursive: true });
		}
	}

	async #initPlugins(type) {
		const server = this.#server;
		const init = `${type}Routes`;

		for (const plugin of this.#plugins) {
			if (!plugin[init]) continue;
			await plugin[init](this, server);
		}
	}

	async #initServices() {
		for (const plugin of this.#plugins) {
			const { constructor } = plugin;
			const { name } = constructor;
			const services = this.services;
			const service = services[name] || {};
			let defined = false;
			for (const key of Object.getOwnPropertyNames(constructor)) {
				const desc = constructor[key];
				if (desc == null || typeof desc != "object") continue;
				if (typeof plugin[key] != "function") continue;
				defined = true;
				Object.defineProperty(service, key, {
					enumerable: desc.external,
					value: desc
				});
				delete desc.external;
			}
			if (!services[name] && defined) {
				services[name] = service;
			}
		}
	}

	#initLog() {
		morgan.token('method', (req, res) => {
			return pad(req.method, 4);
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
		if ((this.env == "development" || code >= 500) && code != 503) {
			console.error(err);
		}
		res.sendStatus(code);
	}

	#servicesError(err, req, res, next) {
		const code = getCode(err);
		if ((this.env == "development" || code >= 500) && code != 404) {
			console.error(err);
		}
		res.status(code).send(err);
	}

	#filesError(err, req, res, next) {
		const code = getCode(err);
		if ((this.env == "development" || code >= 500) && code != 404) {
			console.error(err);
		}
		if (code >= 400) {
			this.log(req, res, () => {
				res.sendStatus(code);
			});
		} else {
			res.sendStatus(code);
		}
	}

	#viewsError(err, req, res, next) {
		const code = getCode(err);
		if ((this.env == "development" || code >= 500) && code != 404) {
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
