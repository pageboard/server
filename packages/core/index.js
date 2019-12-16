require('promise.prototype.finally').shim();
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
const xdg = require('xdg-basedir');
const resolvePkg = require('resolve-pkg');
const debug = require('debug')('pageboard:core');
const http = require.lazy('http');
const fs = require('fs').promises;

util.inspect.defaultOptions.depth = 10;

const Domains = require.lazy('./lib/domains');
const Install = require('./lib/install');

// exceptional but so natural
global.HttpError = require('http-errors');
global.Text = require('outdent');

exports.config = function(pkgOpt) {
	var dir = Path.resolve(__dirname, '..', '..');
	pkgOpt = Object.assign({}, require(Path.join(dir, 'package.json')), pkgOpt);
	var name = pkgOpt.name;
	var opt = rc(name, {
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
			runtime: Path.join(xdg.runtime, name)
		},
		elements: [],
		directories: [],
		plugins: [],
		dependencies: pkgOpt.dependencies || {},
		core: {
			log: ':method :status :time :size :site :url'
		},
		report: {},
		upstreams: {}
	});
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
	).catch(function() {});
}

exports.init = function(opt) {
	var All = {
		opt: opt,
		utils: {}
	};
	All.utils.which = pify(require('which'));
	All.install = install.bind(All);
	All.domains = new Domains(All);
	All.app = createApp(All);

	if (opt.global) global.All = All;

	All.log = initLog(opt);

	var plugins = [];
	return (opt.installer.path ? Promise.resolve(opt.installer.path) : All.utils.which(opt.installer.bin)).then(function(path) {
		console.info("core:\tinstaller.path", path);
		opt.installer.path = path;
	}).then(function() {
		return Promise.all(Object.keys(opt.dependencies).map(function(module) {
			var pkgPath = resolvePkg(module, {cwd: opt.dir});
			return Install.config(pkgPath, "pageboard", module, All.opt);
		})).then(function(modules) {
			opt.plugins = modules.filter(x => !!x);
			var plugin, module;
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
				var obj = plugin(opt);
				if (!obj) {
					console.warn("plugin not configured", module);
					continue;
				}
				obj.plugin = plugin;
				plugins.push(obj);
			}
		});
	}).then(function() {
		return initDirs(opt.dirs);
	}).then(function() {
		return initPlugins.call(All, plugins);
	}).then(function() {
		return initPlugins.call(All, plugins, 'file');
	}).then(function() {
		All.app.use(filesError);
		All.app.use(All.log);
		return initPlugins.call(All, plugins, 'service');
	}).then(function() {
		All.app.use(function(req, res, next) {
			if (req.url.startsWith('/.api/')) {
				throw new HttpError.NotFound("Unknown api url");
			}
			next();
		});
		All.app.use(servicesError);
		if (!All.opt.cli) return initPlugins.call(All, plugins, 'view');
	}).then(function() {
		All.app.use(viewsError);
	}).then(function() {
		return All.statics.install(null, All.opt, All);
	}).then(function() {
		return All.api.install(null, All.opt, All);
	}).then(function() {
		return All.cache.install(null, All.opt, All);
	}).then(function() {
		return All;
	});
};

function install(site) {
	var All = this;
	if (site.href) {
		All.domains.promote(site);
		All.domains.hold(site);
	}

	return Install.install(site, All.opt).then(function(pkg) {
		return All.api.install(site, pkg, All).then(function(bundles) {
			if (site.href) return All.statics.install(site, pkg, All).then(function() {
				return All.api.validate(site, pkg, bundles);
			});
		}).then(function() {
			return All.auth.install(site);
		}).then(function() {
			if (site.href) return All.cache.install(site);
		}).then(function() {
			return Install.clean(site, pkg, All.opt);
		});
	}).then(function(pkg) {
		if (site.href) {
			All.domains.replace(site);
			All.domains.release(site);
		}
		return site;
	}).catch(function(err) {
		if (site.href) All.domains.error(site, err);
		if (All.opt.env == "development") console.error(err);
		throw err;
	});
}

exports.start = function(All) {
	var server = http.createServer(All.app);
	server.listen(All.opt.port);
	console.info(`Listening on port ${All.opt.port}`);
};

function initDirs(dirs) {
	return Promise.all(Object.keys(dirs).map(function(key) {
		debug("init dir", dirs[key]);
		return fs.mkdir(dirs[key], {
			recursive: true
		});
	}));
}

function initPlugins(plugins, type) {
	var All = this;
	if (type == "service") {
		All.services = {};
	}
	plugins = plugins.filter(function(obj) {
		if (type && !obj[type]) return false;
		if (!type && (obj.file || obj.service || obj.view)) return false;
		return true;
	}).sort(function(a, b) {
		a = a.priority != null ? a.priority : Infinity;
		b = b.priority != null ? b.priority : Infinity;
		if (a == b) return 0;
		else if (a > b) return 1;
		else if (a < b) return -1;
	});
	var p = Promise.resolve();
	plugins.forEach(function(obj) {
		var to;
		if (obj.name) {
			to = All[obj.name] = All[obj.name] || {};
		} else {
			to = All;
		}
		if (type) {
			p = p.then(() => obj[type].call(obj, All));
		} else if (obj.init) {
			p = p.then(() => obj.init.call(obj, All));
		}
		p = p.then(function() {
			var plugin = obj.plugin = Object.assign({}, obj.plugin); // make a copy
			Object.keys(plugin).forEach(function(key) {
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
	return p.catch(function(err) {
		console.error(err);
	});
}

function initLog(opt) {
	morgan.token('method', function(req, res) {
		return pad(req.method, 4);
	});
	morgan.token('status', function(req, res) {
		return pad(3, res.statusCode);
	});
	morgan.token('time', function(req, res) {
		var ms = morgan['response-time'](req, res, 0);
		if (ms) return pad(4, ms) + 'ms';
		else return pad(6, '');
	});
	morgan.token('type', function(req, res) {
		return pad(4, (res.get('Content-Type') || '-').split(';').shift().split('/').pop());
	});
	morgan.token('size', function(req, res) {
		var len = parseInt(res.get('Content-Length'));
		return pad(6, (len && prettyBytes(len) || '0 B').replaceAll(' ', ''));
	});
	morgan.token('site', function(req, res) {
		return pad(req.site && req.site.id && req.site.id.substring(0, 8) || req.hostname, 8);
	});

	return morgan(opt.core.log, {
		skip: function(req, res) {
			return false;
		}
	});
}

function createApp(All) {
	var app = express();
	var opt = All.opt;
	// for csp headers, see prerender and write
	app.set("env", opt.env);
	app.disable('x-powered-by');
	app.enable('trust proxy');
	app.get("/.well-known/pageboard", All.domains.wkp);
	app.use(All.domains.mw);
	app.use(function(req, res, next) {
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
	var msg = err.message || err.toString();
	var fullCode = err.statusCode || err.code;
	var code = parseInt(fullCode);
	if (isNaN(code) || code < 200 || code >= 600) {
		msg += "\nerror code: " + fullCode;
		code = 500;
	}
	if (All.opt.env == "development" || code >= 500) console.error(err);
	if (msg) res.status(code).send({
		message: msg
	});
	else res.sendStatus(code);
}

function filesError(err, req, res, next) {
	var code = parseInt(err.statusCode || err.code);
	if (isNaN(code) || code < 200 || code >= 600) {
		code = 500;
	}
	if (code >= 500) console.error(err);
	if (code >= 400) All.log(req, res, function() {
		res.sendStatus(code);
	});
	else res.sendStatus(code);
}

function viewsError(err, req, res, next) {
	var code = parseInt(err.statusCode || err.code);
	if (isNaN(code) || code < 200 || code >= 600) {
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


