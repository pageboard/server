var pify = require('util').promisify;
if (!pify) pify = require('util').promisify = require('util-promisify');
var Path = require('path');
var express = require('express');
var bodyParserJson = require('body-parser').json();
var morgan = require('morgan');
var pad = require('pad');
var prettyBytes = require('pretty-bytes');
var rc = require('rc');
var mkdirp = pify(require('mkdirp'));
var xdg = require('xdg-basedir');
var pkgup = require('pkg-up');
var equal = require('esequal');
var debug = require('debug')('pageboard:core');

var fs = {
	writeFile: pify(require('fs').writeFile),
	readFile: pify(require('fs').readFile),
	readdir: pify(require('fs').readdir),
	stat: pify(require('fs').stat),
	unlink: pify(require('fs').unlink)
};

var cp = {
	exec: pify(require('child_process').exec)
};

// exceptional but so natural
global.HttpError = require('http-errors');

exports.config = function(pkgOpt) {
	var cwd = process.cwd();
	pkgOpt = Object.assign({}, require(cwd + '/package.json'), pkgOpt);
	var name = pkgOpt.name;
	var opt = rc(name, {
		cwd: cwd,
		env: pkgOpt.env || process.env.NODE_ENV || 'development',
		name: name,
		version: pkgOpt.version,
		global: true,
		listen: 3000,
		logFormat: ':method :status :time :size :type :url',
		dirs: {
			cache: Path.join(xdg.cache, name),
			data: Path.join(xdg.data, name),
			runtime: Path.join(xdg.runtime, name)
		},
		elements: [],
		directories: [],
		plugins: [],
		dependencies: pkgOpt.dependencies || {}
	});
	return opt;
};

exports.init = function(opt) {
	var app = createApp(opt);

	var All = {
		app: app,
		opt: opt
	};
	All.run = run.bind(All);
	All.query = reqQuery.bind(All);
	All.body = reqBody.bind(All);
	All.install = install.bind(All);
	All.domains = new Domains(All);

	if (opt.global) global.All = All;

	Object.keys(opt.dependencies).forEach(function(module) {
		opt.plugins.push(module);
	});

	var pluginList = [];

	while (opt.plugins.length) {
		var module = opt.plugins.shift();
		var plugin;
		try {
			plugin = require(module);
		} catch(ex) {
			console.error("Cannot require plugin", module, ex);
			continue;
		}
		if (typeof plugin != "function") continue;
		var obj = plugin(opt) || {};
		obj.plugin = plugin;
		pluginList.push(obj);
	}

	All.log = initLog(opt);

	return Promise.all(Object.keys(opt.dependencies).map(function(module) {
		return pkgup(require.resolve(module)).then(function(pkgPath) {
			return initConfig(Path.dirname(pkgPath), null, module, All.opt);
		});
	})).then(function() {
		return initDirs(opt.dirs);
	}).then(function() {
		return initPlugins.call(All, pluginList);
	}).then(function() {
		return initPlugins.call(All, pluginList, 'file');
	}).then(function() {
		app.use(filesError);
		app.use(All.log);
		return initPlugins.call(All, pluginList, 'service');
	}).then(function() {
		app.use('/.api/*', function(req, res, next) {
			next(new HttpError.NotFound(`Cannot ${req.method} ${req.originalUrl}`));
		});
		app.use(servicesError);
		return initPlugins.call(All, pluginList, 'view');
	}).then(function() {
		app.use(viewsError);
	}).then(function() {
		return All.statics.install(null, All.opt, All);
	}).then(function() {
		return All.api.install(null, All.opt, All);
	}).then(function() {
//		return All.cache.install(null, All.opt, All);
	}).then(function() {
		initDumps(All);
		return All;
	});
}

function initDirs(dirs) {
	return Promise.all(Object.keys(dirs).map(function(key) {
		debug("init dir", dirs[key]);
		return mkdirp(dirs[key]);
	}));
}

function initPlugins(plugins, type) {
	var All = this;
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

	return morgan(opt.logFormat);
}

function install({domain, dependencies}) {
	if (!domain) throw new Error("Missing domain");
	var All = this;
	var installedBlock;
	var dataDir = Path.join(All.opt.dirs.data, 'sites');
	var domainDir = Path.join(dataDir, domain);
	var config = {
		directories: [],
		elements: []
	};
	var pkgFile = Path.join(domainDir, 'package.json');
	debug("create domain dir", domainDir);
	return mkdirp(domainDir).then(function() {
		var doInstall = true;
		return fs.readFile(pkgFile).then(function(json) {
			var obj = JSON.parse(json);
			if (equal(obj.dependencies, dependencies)) {
				debug("no change in dependencies");
				doInstall = false;
			}
		}).catch(function(ex) {
			// whatever
		}).then(function() {
			if (!doInstall) return;
			return fs.writeFile(pkgFile, JSON.stringify({
				name: domain,
				dependencies: dependencies
			}));
		}).then(function() {
			if (!doInstall) return;
			return npmInstall(domainDir);
		});
	}).then(function() {
		return Promise.all(Object.keys(dependencies || {}).map(function(module) {
			return initConfig(Path.join(domainDir, 'node_modules', module), domain, module, config);
		}));
	}).then(function() {
		return All.statics.install(domain, config, All);
	}).then(function() {
		return All.api.install(domain, config, All);
	}).then(function(Block) {
		installedBlock = Block;
		return All.cache.install(domain, config, All);
	}).then(function() {
		return installedBlock;
	}).catch(function(err) {
		console.error(err);
	});
};

function npmInstall(domainDir) {
	debug("Installing dependencies", domainDir);
	return cp.exec("npm install", {
		cwd: domainDir,
		timeout: 60 * 1000,
		env: {
			PATH: process.env.PATH,
			npm_config_userconfig: '', // attempt to disable user config
			npm_config_ignore_scripts: 'false',
			npm_config_loglevel: 'error',
			npm_config_progress: 'false',
			npm_config_package_lock: 'false',
			npm_config_only: 'prod'
		}
	});
}

function initConfig(moduleDir, domain, module, config) {
	debug("Module directory", module, moduleDir);
	return fs.readFile(Path.join(moduleDir, 'package.json')).catch(function(err) {
		// it's ok to not have a package.json here
		return false;
	}).then(function(buf) {
		if (buf === false) {
			console.info(`${domain} > ${module} has no package.json, mounting the module directory`);
			config.directories.push({
				from: Path.resolve(moduleDir),
				to: domain ? Path.join('/', '.files', domain, module) : '/.pageboard'
			});
			return;
		}
		var meta = JSON.parse(buf);
		if (!meta.pageboard) return; // nothing to do
		var directories = meta.pageboard.directories || [];
		if (!Array.isArray(directories)) directories = [directories];
		debug("processing directories", directories);
		directories.forEach(function(mount) {
			if (typeof mount == "string") mount = {
				from: mount,
				to: mount
			};
			var from = Path.resolve(moduleDir, mount.from);
			if (from.startsWith(moduleDir) == false) {
				console.warn(`Warning: ${domain} dependency ${module} bad mount from: ${from}`);
				return;
			}
			var rootTo = domain ? Path.join('/', '.files', domain, module) : '/.pageboard';
			var to = Path.resolve(rootTo, mount.to);
			if (to.startsWith(rootTo) == false) {
				console.warn(`Warning: ${domain} dependency ${module} bad mount to: ${to}`);
				return;
			}
			config.directories.push({
				from: from,
				to: to
			});
		});

		var elements = meta.pageboard.elements || [];
		if (!Array.isArray(elements)) elements = [elements];
		debug("processing elements", elements);
		return Promise.all(elements.map(function(path) {
			var absPath = Path.resolve(moduleDir, path);
			return fs.stat(absPath).then(function(stat) {
				if (stat.isDirectory()) return fs.readdir(absPath).then(function(paths) {
					// make sure files are ordered by basename
					paths.sort(function(a, b) {
						a = Path.basename(a);
						b = Path.basename(b);
						if (a == b) return 0;
						else if (a > b) return 1;
						else if (a < b) return -1;
					});
					return paths.map(function(path) {
						return Path.join(absPath, path);
					});
				});
				else return [absPath];
			}).then(function(paths) {
				paths.forEach(function(path) {
					if (path.endsWith('.js')) config.elements.push(path);
				});
			});
		}));
	}).catch(function(err) {
		console.error(`Error: ${domain} dependency ${module} cannot be extracted`, err);
	});
}

function createApp(opt) {
	var app = express();
	// https://www.smashingmagazine.com/2017/04/secure-web-app-http-headers/
	app.set("env", opt.env);
	app.disable('x-powered-by');
	app.use(function(req, res, next) {
		res.setHeader('X-XSS-Protection','1;mode=block');
		res.setHeader('X-Frame-Options', 'SAMEORIGIN');
		if (opt.env != "development") res.setHeader('Content-Security-Policy', "script-src 'self'");
		res.setHeader('X-Content-Type-Options', 'nosniff');
		All.domains.host(req);
		All.api.DomainBlock(req.hostname).then(function(DomainBlock) {
			if (req.get('X-Redirect-Secure') && req.protocol == "http" && req.url != "/.api") {
				res.redirect(301, "https://" + req.get('Host') + req.url);
			} else {
				next();
			}
		}).catch(function(err) {
			next(err);
		});
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
}

function reqBody(req, res, next) {
	var opt = this.opt;
	bodyParserJson(req, res, function() {
		var obj = req.body;
		// all payloads must contain domain
		obj.domain = req.hostname;
		next();
	});
}

function reqQuery(req, res, next) {
	var obj = req.query;
	// all payloads must contain domain
	obj.domain = req.hostname;
	next();
}

function run(apiStr, data) {
	return Promise.resolve().then(function() {
		var api = apiStr.split('.');
		var modName = api[0];
		var funName = api[1];
		var mod = this[modName];
		if (!mod) throw new HttpError.BadRequest(`Unknown api module ${modName}`);
		var fun = mod[funName];
		if (!fun) throw new HttpError.BadRequest(`Unknown api method ${funName}`);
		return fun.call(mod, data || {});
	}.bind(this));
}

function Domains(All) {
	this.All = All;
	this.map = {};
}

Domains.prototype.host = function(req) {
	var domain;
	if (typeof req == "string") {
		domain = req;
		req = null;
	} else {
		domain = req.hostname;
	}
	var obj = this.map[domain];
	if (!obj) obj = this.map[domain] = {};
	if (!obj.host) {
		if (req) {
			obj.host = (req.get('X-Redirect-Secure') ? 'https' : req.protocol) + '://' + req.get('Host');
		} else {
			throw new Error(`Unknown domain ${domain}`);
		}
	}
	return obj.host;
};

function initDumps(All) {
	var opt = All.opt.database.dump;
	if (!opt) return;
	var day = 1000 * 60 * 60 * 24;
	opt = All.opt.database.dump = Object.assign({
		interval: 1,
		dir: Path.join(All.opt.dirs.data, 'dumps'),
		keep: 15
	}, opt);
	console.info("Dumps db every", opt.interval, "days to", opt.dir);
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

