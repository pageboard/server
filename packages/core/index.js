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
var debug = require('debug')('pageboard:core');
var csp = require('content-security-policy-builder');
var http = require('http');
var Domains = require('./lib/domains');

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
			listen: 3000,
			log: ':method :status :time :size :type :url'
		}
	});
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
	var app = createApp(opt);

	var All = {
		app: app,
		opt: opt,
		utils: {}
	};
	All.utils.spawn = require('spawn-please');
	All.utils.which = pify(require('which'));
	All.run = run.bind(All);
	All.query = reqQuery.bind(All);
	All.body = reqBody.bind(All);
	All.install = install.bind(All);
	All.domains = new Domains(All);
	All.domain = function(domain) {
		return All.domains.get(domain);
	};

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

	return All.utils.which(opt.core.installer).then(function(path) {
		console.info("using core installer", path);
		opt.installerPath = path;
	}).then(function() {
		return Promise.all(Object.keys(opt.dependencies).map(function(module) {
			return pkgup(require.resolve(module)).then(function(pkgPath) {
				return initConfig(Path.dirname(pkgPath), null, module, All.opt);
			});
		}));
	}).then(function() {
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
};

exports.start = function(All) {
	var server = http.createServer(All.app);
	server.listen(All.opt.core.listen);
	console.info(`Listening on port ${All.opt.core.listen}`);
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

	return morgan(opt.core.log);
}

function install(data) {
	// actually site.data
	var domain = data.domain;
	var module = data.module;
	if (!domain) throw new Error("Missing domain");
	var All = this;
	var installedBlock;
	var dataDir = Path.join(All.opt.dirs.data, 'sites');
	var domainDir = Path.join(dataDir, domain);
	var config = {
		directories: [],
		elements: []
	};
	debug("install domain in", domainDir);
	return installModules(All.opt, domainDir, module).then(function(moduleName) {
		var siteModuleDir = Path.join(domainDir, 'node_modules', moduleName);
		return fs.readFile(Path.join(siteModuleDir, "package.json")).then(function(buf) {
			return JSON.parse(buf.toString());
		}).then(function(pkg) {
			return Promise.all(Object.keys(pkg.dependencies || {}).map(function(subModule) {
				var moduleDir = Path.join(domainDir, 'node_modules', subModule);
				return initConfig(moduleDir, domain, subModule, config);
			})).then(function() {
				return initConfig(siteModuleDir, domain, moduleName, config);
			});
		});
	}).catch(function(err) {
		if (module) console.error("Could not install", domainDir, module, err);
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

function installModules(opt, domainDir, siteModule) {
	if (!siteModule) return Promise.reject(new Error("no domain module to install"));
	debug("Installing site module", domainDir, siteModule);
	var pkgPath = Path.join(domainDir, 'package.json');
	return mkdirp(domainDir).then(function() {
		return fs.readFile(pkgPath).then(function(buf) {
			var pkg = JSON.parse(buf.toString());
			return pkg.keep;
		}).catch(function(err) {
			return false;
		}).then(function(keep) {
			if (keep) return false;
			return fs.writeFile(pkgPath, JSON.stringify({
				dependencies: {} // npm will populate it for us
			})).then(function() {
				return true;
			});
		});
	}).then(function(install) {
		if (!install) return;
		var baseEnv = {
			HOME: process.env.HOME,
			PATH: process.env.PATH
		};
		if (opt.env == "development" && process.env.SSH_AUTH_SOCK) {
			// some local setup require to pass this to be able to use ssh keys
			baseEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
		}
		if (opt.core.installer == "yarn") {
			return All.utils.spawn(opt.installerPath, [
				"--non-interactive",
				"--ignore-optional",
				"--prefer-offline",
				"--production",
				"--no-lockfile",
				"--silent",
				"add", siteModule
			], {
				cwd: domainDir,
				timeout: 60 * 1000,
				env: baseEnv
			});
		} else {
			return All.utils.spawn(opt.installerPath, [
				"install",
				"--save", siteModule
			], {
				cwd: domainDir,
				timeout: 60 * 1000,
				env: Object.assign(baseEnv, {
					npm_config_userconfig: '', // attempt to disable user config
					npm_config_ignore_scripts: 'false',
					npm_config_loglevel: 'error',
					npm_config_progress: 'false',
					npm_config_package_lock: 'false',
					npm_config_only: 'prod',
					npm_config_prefer_offline: 'true'
				})
			});
		}
	}).then(function(out) {
		if (out) debug(out);
		return fs.readFile(pkgPath).then(function(buf) {
			var pkg = JSON.parse(buf.toString());
			var deps = Object.keys(pkg.dependencies);
			if (!deps.length) throw new Error("Could not install " + siteModule);
			return deps[0];
		});
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
		if (!meta.pageboard) {
			return; // nothing to do
		}
		var directories = meta.pageboard.directories || [];
		if (!Array.isArray(directories)) directories = [directories];
		debug("processing directories from", moduleDir, directories);
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
		debug("processing elements from", moduleDir, elements);
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
					if (path.endsWith('.js')) {
						config.elements.push(path);
					}
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
	// for csp headers, see prerender and write
	app.set("env", opt.env);
	app.disable('x-powered-by');
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
	app.use(function(req, res, next) {
		res.setHeader('X-XSS-Protection','1;mode=block');
		res.setHeader('X-Frame-Options', 'SAMEORIGIN');
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('Content-Security-Policy', cspHeader);
		All.domains.init(req).then(function() {
			if (req.url == "/.well-known/pageboard") {
				res.type('text').sendStatus(200);
			} else if (req.protocol == "http" && All.domain(req.hostname).upgradable) {
				res.redirect(301, "https://" + req.get('Host') + req.url);
			} else {
				next();
			}
		}).catch(function(err) {
			servicesError(err, req, res, next);
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
		return fun.call(mod, this.api.check(fun, data || {}));
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

