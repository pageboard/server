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
			data: Path.join(xdg.data, name)
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

exports.init = function(opt) {
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
	return (opt.installer.path ? Promise.resolve(opt.installer.path) : All.utils.which(opt.installer.bin)).then((path) => {
		// eslint-disable-next-line no-console
		console.info("core:\tinstaller.path", path);
		opt.installer.path = path;
	}).then(() => {
		return Promise.all(Object.keys(opt.dependencies).map((module) => {
			const pkgPath = resolvePkg(module, {cwd: opt.dir});
			return Install.config(pkgPath, "pageboard", module, All.opt);
		})).then((modules) => {
			opt.plugins = modules.filter(x => Boolean(x));
			let plugin, module;
			while (opt.plugins.length) {
				module = opt.plugins.shift();
				try {
					plugin = require(module);
				} catch(ex) {
					console.error("Error loading module", ex);
					plugin = null;
					continue;
				}
				if (typeof plugin != "function") {
					continue;
				}
				const obj = plugin(opt);
				if (!obj) {
					console.warn("plugin not configured", module);
					continue;
				}
				obj.plugin = plugin;
				plugins.push(obj);
			}
		});
	}).then(() => {
		return initDirs(opt.dirs);
	}).then(() => {
		return initPlugins.call(All, plugins);
	}).then(() => {
		return initPlugins.call(All, plugins, 'file');
	}).then(() => {
		All.app.use(filesError);
		All.app.use(All.log);
		return initPlugins.call(All, plugins, 'service');
	}).then(() => {
		All.app.use((req, res, next) => {
			if (req.url.startsWith('/.api/')) {
				throw new HttpError.NotFound("Unknown api url");
			}
			next();
		});
		All.app.use(servicesError);
		if (!All.opt.cli) return initPlugins.call(All, plugins, 'view');
	}).then(() => {
		All.app.use(viewsError);
	}).then(() => {
		return All.statics.install(null, All.opt, All);
	}).then(() => {
		return All.api.install(null, All.opt, All);
	}).then(() => {
		return All.cache.install(null, All.opt, All);
	}).then(() => {
		return All;
	});
};

function install(site) {
	const All = this;
	if (site.url) {
		All.domains.hold(site);
	}

	return Install.install(site, All.opt).then(pkg => {
		return All.api.install(site, pkg, All).then(bundles => {
			if (site.url) return All.statics.install(site, pkg, All).then(() => {
				return All.api.validate(site, pkg, bundles);
			});
		}).then(() => {
			return All.auth.install(site);
		}).then(() => {
			if (site.url) return All.cache.install(site);
		}).then(() => {
			if (All.opt.env != "development") return Install.clean(site, pkg, All.opt);
		}).then(() => {
			if (!site.data.server) site.data.server = pkg.server || All.opt.version;
			if (site.url) {
				All.domains.release(site);
			}
			return site;
		});
	}).catch((err) => {
		if (site.url) All.domains.error(site, err);
		if (All.opt.env == "development") console.error(err);
		throw err;
	});
}

exports.start = function(All) {
	const server = http.createServer(All.app);
	server.listen(All.opt.port);
	// eslint-disable-next-line no-console
	console.info(`port:\t${All.opt.port}`);
};

function initDirs(dirs) {
	return Promise.all(Object.keys(dirs).map((key) => {
		Log.core("init dir", dirs[key]);
		return fs.mkdir(dirs[key], {
			recursive: true
		});
	}));
}

function initPlugins(plugins, type) {
	const All = this;
	if (type == "service") {
		All.services = {};
	}
	plugins = plugins.filter((obj) => {
		if (type && !obj[type]) return false;
		if (!type && (obj.file || obj.service || obj.view)) return false;
		return true;
	}).sort((a, b) => {
		a = a.priority != null ? a.priority : Infinity;
		b = b.priority != null ? b.priority : Infinity;
		if (a == b) return 0;
		else if (a > b) return 1;
		else if (a < b) return -1;
	});
	let p = Promise.resolve();
	plugins.forEach((obj) => {
		let to;
		if (obj.name) {
			to = All[obj.name] = All[obj.name] || {};
		} else {
			to = All;
		}
		if (type) {
			p = p.then(() => obj[type](All));
		} else if (obj.init) {
			p = p.then(() => obj.init(All));
		}
		p = p.then(() => {
			const plugin = obj.plugin = Object.assign({}, obj.plugin); // make a copy
			Object.keys(plugin).forEach((key) => {
				if (to[key] !== undefined) throw new Error(`module conflict ${obj.name || 'All'}.${key}`);
				to[key] = plugin[key];
				delete plugin[key]; // we made a copy before
				if (type == "service" && obj.name != "api" && Object.prototype.hasOwnProperty.call(to[key], 'schema')) {
					if (!All.services[obj.name]) All.services[obj.name] = {};
					Object.defineProperty(All.services[obj.name], key, {
						enumerable: to[key].external,
						get: function() {
							return to[key].schema;
						}
					});
				}
			});
		});
	});
	return p.catch((err) => {
		console.error(err);
	});
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
	const app = express();
	const opt = All.opt;
	// site-specific headers are built by page element and csp filter + prerender
	app.set("env", opt.env);
	app.disable('x-powered-by');
	app.enable('trust proxy');
	app.use(...All.domains.middlewares);
	app.use((req, res, next) => {
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
		next();
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


