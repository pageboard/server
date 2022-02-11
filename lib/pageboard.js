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
const rc = require('rc');
const toml = require.lazy('toml');
const xdg = require('xdg-basedir');
const resolvePkg = require('resolve-pkg');
const http = require.lazy('http');
const fs = require('fs').promises;
const { once } = require('events');

util.inspect.defaultOptions.depth = 10;

const Domains = require.lazy('./lib/domains');
const Installer = require('./lib/install');

// exceptional but so natural
global.HttpError = require('http-errors');
global.Text = require('outdent');
global.Log = require('./log')('pageboard');


module.exports = class Pageboard {
	#server;
	#installer;
	#plugins;
	services = {};

	constructor(name, version) {
		if (!process.env.HOME) throw new Error("Missing HOME environment variable");
		const dir = Path.resolve(__dirname, '..');
		this.utils = require.lazy('./lib/utils');
		// TODO check schema of toml
		const defaults = {
			cwd: process.cwd(),
			dir: dir,
			env: process.env.NODE_ENV || 'development',
			name: name,
			version: version.split('.').slice(0, 2).join('.'),
			installer: {
				bin: 'npm',
				timeout: 60000
			},
			dirs: {
				cache: Path.join(xdg.cache, name),
				data: Path.join(xdg.data, name),
				tmp: Path.join(xdg.data, '../tmp', name)
			},
			elements: [],
			directories: [],
			dependencies: {},
			server: {
				log: ':method :status :time :size :site :url',
				port: 3000
			},
			commons: {},
			upstreams: {}
		};
		const opts = rc(name, defaults, null, (str) => toml.parse(str));

		opts.upstream = opts.upstreams[opts.version];
		if (opts.upstream) opts.port = opts.upstream.split(':').pop();

		opts.installer.timeout = parseInt(opts.installer.timeout);
		opts.cli = opts._.length > 0;

		// all these become direct properties
		for (const key in defaults) {
			this[key] = opts[key];
			delete opts[key];
		}
		// other properties (used by plugins)
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

	#loadPlugin(path) {
		try {
			const Mod = require(path);
			const opts = this.opts[Mod.name];
			this.#plugins.push(new Mod(this, opts));
			if (Mod.plugins) this.#loadPlugins(Mod);
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

		this.domains = new Domains(this);
		const server = this.#server = this.#createServer();
		this.#initLog();
		this.#installer = new Installer(this, this.opts.installer);

		this.#plugins = [];
		this.#loadPlugins({
			plugins: await Promise.all(Object.keys(this.dependencies).map(module => {
				const pkgPath = resolvePkg(module, { cwd: this.dir });
				return this.#installer.config(pkgPath, "pageboard", module, this.opts);
			})).filter(x => Boolean(x))
		});

		// TODO plugins sort() now
		await this.#initDirs(this.dirs);

		// call plugins#init
		await this.#initPlugins();

		// call plugins#file
		await this.#initPlugins('file');
		server.use((...args) => this.#filesError(...args));
		server.use((...args) => this.log(...args));

		// call plugins#service
		await this.#initPlugins('service');
		server.use((req) => {
			if (req.url.startsWith('/.api/')) {
				throw new HttpError.NotFound("Unknown api url");
			}
		});
		server.use((...args) => this.#servicesError(...args));

		// call plugins#view
		if (!this.opts.cli) await this.#initPlugins('view');
		server.use((...args) => this.#viewsError(...args));

		await this.statics.install();
		await this.api.install();
		await this.cache.install();
	}

	#createServer() {
		const server = require('./lib/express-async')(express)();
		// site-specific headers are built by page element and csp filter + prerender
		server.set("env", this.env);
		server.disable('x-powered-by');
		server.enable('trust proxy');
		server.use(...this.domains.middlewares);
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
				await this.api.validate(site, pkg, bundles);
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
		server.listen(this.port);
		await once(server, 'listening');
		console.info(`port:\t${this.port}`);
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

		for (const plugin of this.#plugins) {
			if (!plugin[type]) continue;
			const { name, constructor } = plugin;
			const to = this[name] = this[name] || {};
			await plugin[type](this, server);

			for (const key of constructor) {
				if (to[key] !== undefined) {
					throw new Error(`plugin conflict ${name || 'app'}.${key}`);
				}
				to[key] = plugin[key];
				if (type == "service") {
					const services = this.services;
					if (!services[name]) services[name] = {};
					const desc = constructor[key];
					if (desc) {
						Object.defineProperty(services[name], key, {
							enumerable: desc.external,
							value: desc
						});
						delete desc.external;
					}
				}
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
			return pad(req.site && req.site.id && req.site.id.substring(0, 8) || "-", 8);
		});

		this.log = morgan(this.logFormat, {
			skip: function (req, res) {
				return false;
			}
		});
	}

	#servicesError(err, req, res, next) {
		const fullCode = err.statusCode || err.status || err.code;
		let code = parseInt(fullCode);
		if (Number.isNaN(code) || code < 200 || code >= 600) {
			err.code = fullCode;
			code = 500;
		}
		if (this.env == "development" || code >= 500) console.error(err);
		res.status(code).send(err);
	}

	#filesError(err, req, res, next) {
		let code = parseInt(err.statusCode || err.status || err.code);
		if (Number.isNaN(code) || code < 200 || code >= 600) {
			code = 500;
		}
		if (code >= 500) console.error(err);
		if (code >= 400) this.log(req, res, () => {
			res.sendStatus(code);
		});
		else res.sendStatus(code);
	}

	#viewsError(err, req, res, next) {
		let code = parseInt(err.statusCode || err.status || err.code);
		if (Number.isNaN(code) || code < 200 || code >= 600) {
			code = 500;
		}
		if (res.headersSent) {
			console.error(err);
		} else {
			res.status(code);
		}
		res.end(err.toString());
	}
};
