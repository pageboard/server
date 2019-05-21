var pify = require('util').promisify;
if (!pify) pify = require('util').promisify = require('util-promisify');
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
var pkgup = require('pkg-up');
var debug = require('debug')('pageboard:core');
var csp = require('content-security-policy-builder');
var http = require('http');

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
	var cwd = process.cwd();
	pkgOpt = Object.assign({}, require(cwd + '/package.json'), pkgOpt);
	var name = pkgOpt.name;
	var opt = rc(name, {
		cwd: cwd,
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
			log: ':method :status :time :size :site:url'
		},
		extnames: [],
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
	return opt;
};

function symlinkDir(opt, name) {
	return fs.symlink(
		Path.join(opt.dirs.data, name),
		Path.join(opt.cwd, name)
	).catch(function() {});
}

exports.init = function(opt) {
	var All = {
		opt: opt,
		utils: {}
	};
	All.utils.which = pify(require('which'));
	All.run = run.bind(All);
	All.install = install.bind(All);
	All.domains = new Domains(All);
	All.app = createApp(All);

	if (opt.global) global.All = All;

	All.log = initLog(opt);

	var plugins = [];
	return (opt.installer.path ? Promise.resolve(opt.installer.path) : All.utils.which(opt.installer.bin)).then(function(path) {
		console.info("using installer.path", path);
		opt.installer.path = path;
	}).then(function() {
		return Promise.all(Object.keys(opt.dependencies).map(function(module) {
			return pkgup(resolvePkg(module)).then(function(pkgPath) {
				return Install.config(Path.dirname(pkgPath), "pageboard", module, All.opt);
			});
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

	var config = {
		directories: [],
		elements: []
	};
	return Install.install(site, All.opt).then(function(pkg) {
		return All.api.install(site, pkg, All).then(function() {
			return All.statics.install(site, pkg, All).then(function() {
				return All.api.validate(site, pkg);
			});
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

	return morgan(opt.core.log);
}

function createApp(All) {
	var app = express();
	var opt = All.opt;
	// https://www.smashingmagazine.com/2017/04/secure-web-app-http-headers/
	// for csp headers, see prerender and write
	app.set("env", opt.env);
	app.disable('x-powered-by');
	app.enable('trust proxy');
	var cspDefault = ["'self'", 'https:'];
	var cspHeader = csp({
		directives: {
			defaultSrc: cspDefault,
			scriptSrc: cspDefault.concat(["'unsafe-eval'"]),
			styleSrc: cspDefault.concat(["'unsafe-inline'"]),
			fontSrc: cspDefault.concat(["data:"]),
			imgSrc: cspDefault.concat(["data:"])
		}
	});
	app.use(All.domains.init);
	app.use(function(req, res, next) {
		if (req.path == "/.well-known/pageboard") {
			res.type("json").send({errors: req.site.errors});
		} else {
			res.setHeader('X-XSS-Protection','1;mode=block');
			res.setHeader('X-Frame-Options', 'SAMEORIGIN');
			res.setHeader('X-Content-Type-Options', 'nosniff');
			res.setHeader('Content-Security-Policy', cspHeader);
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

function run(apiStr) {
	var args = Array.prototype.slice.call(arguments, 1);
	return Promise.resolve().then(function() {
		var api = apiStr.split('.');
		var modName = api[0];
		var funName = api[1];
		var mod = this[modName];
		if (!mod) throw new HttpError.BadRequest(`Unknown api module ${modName}`);
		var fun = mod[funName];
		if (!fun) throw new HttpError.BadRequest(`Unknown api method ${funName}`);
		if (args.length != fun.length) {
			throw new HttpError.BadRequest(`Api method ${funName} expected ${fun.length} arguments, and got ${args.length} arguments`);
		}
		var data = args[args.length - 1] || {};
		try {
			args[args.length - 1] = this.api.check(fun, data);
		} catch(err) {
			console.error(`run ${apiStr} ${JSON.stringify(data)}`);
			throw err;
		}
		// start a transaction on set trx object on site
		var site = args.length == 2 ? args[0] : null;
		var hadTrx = false;
		return Promise.resolve().then(function() {
			if (!site) {
				return;
			}
			if (site.trx) {
				hadTrx = true;
				return;
			}
			return All.api.transaction().then(function(trx) {
				site.trx = trx;
			});
		}).then(function() {
			return fun.apply(mod, args);
		}).then(function(obj) {
			if (!hadTrx && site) {
				return site.trx.commit().then(function() {
					return obj;
				});
			}
			return obj;
		}).catch(function(err) {
			if (!hadTrx && site) {
				return site.trx.rollback().then(function() {
					throw err;
				});
			} else {
				throw err;
			}

		});
	}.bind(this));
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

