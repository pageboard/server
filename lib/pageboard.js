require('string.prototype.replaceall').shim();

const importLazy = require('import-lazy');
Object.getPrototypeOf(require).lazy = function(str) {
	return importLazy(this)(str);
};

const util = require('util');
const Path = require('path');
const express = require('express');
const morgan = require('morgan');
const pad = require('pad');
const prettyBytes = require('pretty-bytes');
const resolvePkg = require('resolve-pkg');
const http = require.lazy('http');
const fs = require('fs').promises;
const { once } = require('events');

util.inspect.defaultOptions.depth = 10;

const Domains = require.lazy('./domains');
const utils = require.lazy('./utils');
const Installer = require('./install');

// exceptional but so natural
global.HttpError = require('http-errors');
global.Text = require('outdent');
global.Log = require('./log')('pageboard');


module.exports = class Pageboard {
	#server;
	#installer;
	#plugins;
	services = {};
	elements = [];
	directories = [];
	cwd = process.cwd();

	constructor(opts) {
		this.utils = utils;
		// TODO check schema of toml
		const defaults = {
			name: null,
			version: null,
			upstream: null,
			cli: false,
			env: process.env.NODE_ENV || 'development',
			installer: {
				bin: 'npm',
				timeout: 60000
			},
			dirs: {
				config: 'config',
				cache: 'cache',
				data: 'data',
				tmp: 'tmp'
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
				port: 3000
			},
			commons: {},
			upstreams: {},
			versions: {}
		};
		opts = this.utils.mergeRecursive(defaults, opts);

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
				Path.join(this.dir, name)
			);
		} catch (err) {
			// pass
		}
	}

	async run(...args) {
		return this.api.run(...args);
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
		this.#loadPlugins({
			plugins: (await Promise.all(
				this.opts.plugins.map(module => {
					const pkgPath = resolvePkg(module, { cwd: this.dir });
					return this.#installer
						.config(pkgPath, "pageboard", module, opts);
				})
			)).filter(x => Boolean(x))
		});
		await this.#initDirs(this.dirs);

		this.#plugins.sort((a, b) => {
			return a.constructor.priority || 0 - b.constructor.priority || 0;
		});

		this.domains = new Domains(this, opts);
		this.domains.routes(this, server);
		server.use((err, req, res, next) =>
			this.#domainsError(err, req, res, next));

		this.#initServices();

		// call plugins#file
		await this.#initPlugins('file');
		server.use((err, req, res, next) =>
			this.#filesError(err, req, res, next));
		server.use((...args) => this.log(...args));

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

		await this.statics.install();
		await this.api.install();
		await this.cache.install();
	}

	#createServer() {
		const server = require('./express-async')(express)();
		// site-specific headers are built by page element and csp filter + prerender
		server.set("env", this.env);
		server.disable('x-powered-by');
		server.enable('trust proxy');
		server.use((req, res) => {
			res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
			res.setHeader('Content-Security-Policy', [
				"default-src 'self'",
				"style-src 'self' 'unsafe-inline'",
				"font-src 'self' data:",
				"img-src 'self' data:"
			].join('; '));
			res.setHeader('X-XSS-Protection', '1;mode=block');
			res.setHeader('X-Frame-Options', 'sameorigin');
			res.setHeader('X-Content-Type-Options', 'nosniff');
		});
		return server;
	}

	async install(site) {
		if (site.url) {
			this.domains.hold(site);
		}
		try {
			const pkg = await this.#installer.install(site, this);
			const bundles = this.api.install(site, pkg);
			if (site.url) {
				await this.statics.install(site, pkg);
				await this.api.finishInstall(site, pkg, bundles);
			}
			await this.auth.install(site);
			if (site.url) await this.cache.install(site);
			if (this.env != "development") await this.#installer.clean(site, pkg);
			if (!site.data.server) {
				site.data.server = pkg.server || this.version;
			}
		} catch (err) {
			if (site.url) this.domains.error(site, err);
			if (this.env == "development") console.error(err);
			throw err;
		}
		if (site.url) {
			this.domains.release(site);
		}
		return site;
	}

	async start() {
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
				await fs.rmdir(dir, { recursive: true });
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
			if (!services[name]) services[name] = {};
			for (const key in constructor) {
				const desc = constructor[key];
				if (desc == null || typeof desc != "object") continue;
				if (typeof plugin[key] != "function") continue;
				Object.defineProperty(services[name], key, {
					enumerable: desc.external,
					value: desc
				});
				delete desc.external;
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
		if (this.env == "development" || code >= 500) {
			console.error(err);
		}
		res.status(code).send(err);
	}

	#filesError(err, req, res, next) {
		const code = getCode(err);
		if (this.env == "development" || code >= 500) {
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
		if (this.env == "development" || code >= 500) {
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
