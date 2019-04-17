var util = require('util');
var pify = util.promisify;
if (!pify) pify = util.promisify = require('util-promisify');
if (!Promise.prototype.finally) require('promise.prototype.finally').shim();
var Path = require('path');
var express = require('express');
var morgan = require('morgan');
var pad = require('pad');
var prettyBytes = require('pretty-bytes');
var rc = require('rc');
var mkdirp = pify(require('mkdirp'));
var xdg = require('xdg-basedir');
var resolvePkg = require('resolve-pkg');
var debug = require('debug')('pageboard:core');
var http = require('http');

util.inspect.defaultOptions.depth = 10;

var Domains = require('./lib/domains');
var Install = require('./lib/install');

var fs = {
	writeFile: pify(require('fs').writeFile),
	readFile: pify(require('fs').readFile),
	readdir: pify(require('fs').readdir),
	stat: pify(require('fs').stat),
	unlink: pify(require('fs').unlink),
	symlink: pify(require('fs').symlink)
};

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
			installer: "npm",  // or yarn
			log: ':method :status :time :size :site:url'
		},
		report: {},
		extnames: [],
		upstreams: {}
	});
	opt.upstream = opt.upstreams[opt.version];
	if (!opt.port) {
		if (opt.upstream) opt.port = opt.upstream.split(':').pop();
		else opt.port = 3000;
	}
	symlinkDir(opt, 'sites');
	symlinkDir(opt, 'uploads');
	symlinkDir(opt, 'dumps');
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
	All.utils.spawn = require('spawn-please');
	All.utils.which = pify(require('which'));
	All.install = install.bind(All);
	All.domains = new Domains(All);
	All.app = createApp(All);

	if (opt.global) global.All = All;

	All.log = initLog(opt);

	var plugins = [];

	return All.utils.which(opt.core.installer).then(function(path) {
		console.info("using core installer", path);
		opt.installerPath = path;
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
				if (typeof plugin != "function") continue;
				var obj = plugin(opt) || {};
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
		All.app.use(servicesError);
		return initPlugins.call(All, plugins, 'view');
	}).then(function() {
		All.app.use(viewsError);
	}).then(function() {
		return All.statics.install(null, All.opt, All);
	}).then(function() {
		return All.api.install(null, All.opt, All);
	}).then(function() {
		return All.cache.install(null, All.opt, All);
	}).then(function() {
		initDumps(All);
		return All;
	});
};

function install(site) {
	var All = this;
	All.domains.promote(site);
	All.domains.hold(site);

	return Install.install(site, All.opt).then(function(pkg) {
		return All.api.install(site, pkg, All).then(function() {
			return All.statics.install(site, pkg, All).then(function() {
				return All.api.validate(site, pkg);
			});
		}).then(function() {
			return All.auth.install(site);
		}).then(function() {
			return All.cache.install(site);
		}).then(function() {
			return Install.clean(site, pkg, All.opt);
		});
	}).then(function(pkg) {
		All.domains.replace(site);
		All.domains.release(site);
		return site;
	}).catch(function(err) {
		All.domains.error(site, err);
		if (All.opt.env == "development") console.error(err);
		throw err;
	});
}

exports.start = function(All) {
	var server = http.createServer(All.app);
	server.listen(All.opt.port);
	console.info(`Listening on port ${All.opt.port}`);
	setTimeout(function() {
		All.api.gc(All);
	}, 1000);
};

function initDirs(dirs) {
	return Promise.all(Object.keys(dirs).map(function(key) {
		debug("init dir", dirs[key]);
		return mkdirp(dirs[key]);
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
		a = a.priority || Infinity;
		b = b.priority || Infinity;
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
				if (type == "service" && obj.name != "api" && to[key].hasOwnProperty('schema') && to[key].external) {
					if (!All.services[obj.name]) All.services[obj.name] = {};
					Object.defineProperty(All.services[obj.name], key, {
						enumerable: true,
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
		return pad(6, (len && prettyBytes(len) || '0 B').replace(/ /g, ''));
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
	app.use(All.domains.init);
	app.use(function(req, res, next) {
		if (req.path == "/.well-known/pageboard") {
			if (req.site.upstream) {
				res.set('X-Upstream', req.site.upstream);
			}
			res.type("json").send({
				errors: req.site.errors
			});
		} else {
			if (req.site.upstream) {
				console.error(
					"Only requests to /.well-known/pageboard should be made to another upstream:",
					req.site.upstream, req.site.data.version,
					"by", opt.version, req.hostname, req.url
				);
				throw new HttpError.BadRequest("Bad upstream");
			}
			res.setHeader('Referrer-Policy', 'same-origin');
			res.setHeader('X-XSS-Protection','1;mode=block');
			res.setHeader('X-Frame-Options', 'sameorigin');
			res.setHeader('X-Content-Type-Options', 'nosniff');
			next();
		}
	});
	app.use(function(err, req, res, next) {
		var handler;
		if (req.url.startsWith('/.api/') || req.url.startsWith('/.well-known/')) handler = servicesError;
		else if (req.url.startsWith('/.')) handler = filesError;
		else handler = viewsError;
		handler(err, req, res, next);
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
	if (msg) res.status(code).send(msg);
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
	if (All.opt.env == "development" || code >= 500) console.error(err);
	res.sendStatus(code);
//	res.redirect(req.app.settings.errorLocation + '?code=' + code);
}

function initDumps(All) {
	var opt = All.opt.database.dump;
	if (!opt) return;
	var day = 1000 * 60 * 60 * 24;
	opt = All.opt.database.dump = Object.assign({
		interval: 1,
		dir: Path.join(All.opt.dirs.data, 'dumps'),
		keep: 15
	}, opt);
	console.info(`Dumps db
 every ${opt.interval} days
 for ${opt.keep} days
 to ${opt.dir}`);
	var job = new (require("cron").CronJob)({
		cronTime: `0 3 */${opt.interval} * *`,
		onTick: function() {
			doDump(All, opt.dir, opt.interval * opt.keep * day);
		}
	});
	job.start();
}

function doDump(All, dir, keep) {
	All.api.dump();
	var now = Date.now();
	mkdirp(dir).then(function() {
		fs.readdir(dir).then(function(files) {
			files.forEach(function(file) {
				file = Path.join(dir, file);
				fs.stat(file).then(function(stat) {
					if (stat.mtime.getTime() < now - keep - 1000) {
						fs.unlink(file);
					}
				});
			});
		});
	});
}

