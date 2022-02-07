require('promise.prototype.finally').shim();
require('promise.allsettled').shim();
require('string.prototype.replaceall').shim();

const importLazy = require('import-lazy');
Object.getPrototypeOf(require).lazy = function(str) {
	return importLazy(this)(str);
};

const util = require('util');
const pify = util.promisify = util.promisify || require('util-promisify');
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
const matchdom = require('matchdom');

util.inspect.defaultOptions.depth = 10;

const Domains = require.lazy('./lib/domains');
const Install = require('./lib/install');

// exceptional but so natural
global.HttpError = require('http-errors');
global.Text = require('outdent');
global.Log = require('./lib/log')('pageboard');

exports.config = function(pkgOpt) {
	const dir = Path.resolve(__dirname, '..', '..');
	pkgOpt = Object.assign({}, require(Path.join(dir, 'package.json')), pkgOpt);
	const name = pkgOpt.name;
	const opt = rc(name, {
		cwd: process.cwd(),
		dir: dir,
		env: pkgOpt.env || process.env.NODE_ENV || 'development',
		name: name,
		version: pkgOpt.version.split('.').slice(0, 2).join('.'),
		installer: {
			bin: 'npm',
			timeout: 60000
		},
		global: true,
		dirs: {
			cache: Path.join(xdg.cache, name),
			data: Path.join(xdg.data, name),
			tmp: Path.join(xdg.data, '../tmp', name)
		},
		elements: [],
		directories: [],
		plugins: [],
		dependencies: pkgOpt.dependencies || {},
		core: {
			log: ':method :status :time :size :site :url'
		},
		commons: {},
		upstreams: {}
	}, null, (str) => toml.parse(str));
	opt.upstream = opt.upstreams[opt.version];
	if (!opt.port) {
		if (opt.upstream) opt.port = opt.upstream.split(':').pop();
		else opt.port = 3000;
	}
	opt.installer.timeout = parseInt(opt.installer.timeout);
	symlinkDir(opt, 'sites');
	symlinkDir(opt, 'uploads');
	symlinkDir(opt, 'dumps');
	opt.cli = opt._.length > 0;
	return opt;
};

function symlinkDir(opt, name) {
	return fs.symlink(
		Path.join(opt.dirs.data, name),
		Path.join(opt.dir, name)
	).catch(() => {});
}

exports.init = async function(opt) {
	const All = {
		opt: opt,
		utils: {}
	};
	All.utils.which = pify(require('which'));
	All.utils.fuse = matchdom;
	All.install = install.bind(All);
	All.domains = new Domains(All);
	All.app = createApp(All);

	if (opt.global) global.All = All;

	All.log = initLog(opt);

	const plugins = [];
	if (!opt.installer.path) {
		opt.installer.path = await All.utils.which(opt.installer.bin);
	}
	// eslint-disable-next-line no-console
	console.info("core:\tinstaller.path", opt.installer.path);
	const modules = await Promise.all(Object.keys(opt.dependencies).map((module) => {
		const pkgPath = resolvePkg(module, { cwd: opt.dir });
		return Install.config(pkgPath, "pageboard", module, All.opt);
	}));
	opt.plugins = modules.filter(x => Boolean(x)).map(module => {
		return require(module)(opt);
	});
	await initDirs(opt.dirs);
	await initPlugins.call(All, plugins);
	await initPlugins.call(All, plugins, 'file');
	All.app.use(filesError);
	All.app.use(All.log);
	await initPlugins.call(All, plugins, 'service');
	All.app.use((req) => {
		if (req.url.startsWith('/.api/')) {
			throw new HttpError.NotFound("Unknown api url");
		}
	});
	All.app.use(servicesError);
	if (!All.opt.cli) await initPlugins.call(All, plugins, 'view');
	All.app.use(viewsError);
	await All.statics.install(null, All.opt, All);
	await All.api.install(null, All.opt, All);
	await All.cache.install(null, All.opt, All);
	return All;
};

async function install(site) {
	const All = this;
	if (site.url) {
		All.domains.hold(site);
	}
	try {
		const pkg = await Install.install(site, All.opt);
		const bundles = All.api.install(site, pkg, All);
		if (site.url) {
			await All.statics.install(site, pkg, All);
			await All.api.validate(site, pkg, bundles);
		}
		await All.auth.install(site);
		if (site.url) await All.cache.install(site);
		if (All.opt.env != "development") await Install.clean(site, pkg, All.opt);
		if (!site.data.server) {
			site.data.server = pkg.server || All.opt.version;
		}
	} catch (err) {
		if (site.url) All.domains.error(site, err);
		if (All.opt.env == "development") console.error(err);
		throw err;
	}
	if (site.url) {
		All.domains.release(site);
	}
	return site;
}

exports.start = function(All) {
	const server = http.createServer(All.app);
	server.listen(All.opt.port);
	// eslint-disable-next-line no-console
	console.info(`port:\t${All.opt.port}`);
};

async function initDirs(dirs) {
	for (const [key, dir] of Object.entries(dirs)) {
		Log.core("init dir", dir);
		if (key == "tmp") {
			// clean up pageboard tmp dir
			await fs.rmdir(dir, { recursive: true });
		}
		await fs.mkdir(dir, { recursive: true });
	}
}

async function initPlugins(plugins, type) {
	const All = this;
	if (type == "service") {
		All.services = {};
	}
	plugins = plugins.filter((plugin) => {
		if (type && !plugin[type]) {
			return false;
		}
		if (!type && (plugin.file || plugin.service || plugin.view)) {
			return false;
		}
		return true;
	}).sort((a, b) => {
		a = a.priority != null ? a.priority : Infinity;
		b = b.priority != null ? b.priority : Infinity;
		if (a == b) return 0;
		else if (a > b) return 1;
		else if (a < b) return -1;
	});

	for (const plugin of plugins) {
		let to;
		const { name, constructor: PClass } = plugin;
		if (name) {
			to = All[name] = All[name] || {};
		} else {
			to = All;
		}
		if (type) {
			await plugin[type](All);
		} else if (plugin.init) {
			await plugin.init(All);
		}
		for (const key of PClass) {
			if (to[key] !== undefined) {
				throw new Error(`plugin conflict ${name || 'All'}.${key}`);
			}
			to[key] = plugin[key];
			if (type == "service" && name != "api") {
				if (!All.services[name]) All.services[name] = {};
				Object.defineProperty(All.services[name], key, {
					enumerable: PClass[key].external,
					get: function() {
						return PClass[key].schema;
					}
				});
			}
		}
	}
}

function initLog(opt) {
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

	return morgan(opt.core.log, {
		skip: function(req, res) {
			return false;
		}
	});
}

function createApp(All) {
	const app = require('./lib/express-async')(express)();
	const opt = All.opt;
	// site-specific headers are built by page element and csp filter + prerender
	app.set("env", opt.env);
	app.disable('x-powered-by');
	app.enable('trust proxy');
	app.use(...All.domains.middlewares);
	app.use((req, res) => {
		res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
		res.setHeader('Content-Security-Policy', [
			"default-src 'self'",
			"style-src 'self' 'unsafe-inline'",
			"font-src 'self' data:",
			"img-src 'self' data:"
		].join('; '));
		res.setHeader('X-XSS-Protection','1;mode=block');
		res.setHeader('X-Frame-Options', 'sameorigin');
		res.setHeader('X-Content-Type-Options', 'nosniff');
	});
	return app;
}

function servicesError(err, req, res, next) {
	const fullCode = err.statusCode || err.status || err.code;
	let code = parseInt(fullCode);
	if (Number.isNaN(code) || code < 200 || code >= 600) {
		err.code = fullCode;
		code = 500;
	}
	if (All.opt.env == "development" || code >= 500) console.error(err);
	res.status(code).send(err);
}

function filesError(err, req, res, next) {
	let code = parseInt(err.statusCode || err.status || err.code);
	if (Number.isNaN(code) || code < 200 || code >= 600) {
		code = 500;
	}
	if (code >= 500) console.error(err);
	if (code >= 400) All.log(req, res, () => {
		res.sendStatus(code);
	});
	else res.sendStatus(code);
}

function viewsError(err, req, res, next) {
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
//	res.redirect(req.app.settings.errorLocation + '?code=' + code);
}


