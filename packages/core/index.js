var Path = require('path');
var express = require('express');
var bodyParserJson = require('body-parser').json();
var morgan = require('morgan');
var pad = require('pad');
var prettyBytes = require('pretty-bytes');
var rc = require('rc');
var mkdirp = require('mkdirp');
var xdg = require('xdg-basedir');

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
		site: null,
		version: pkgOpt.version,
		global: true,
		listen: 3000,
		logFormat: ':method :status :time :size :type :url',
		plugins: pkgOpt.plugins || [],
		dirs: {
			cache: Path.join(xdg.cache, name),
			data: Path.join(xdg.data, name),
			runtime: Path.join(xdg.runtime, name)
		},
		elements: [],
		statics: {
			mounts: []
		}
	});
	return opt;
};

exports.init = function(opt) {
	initDirs(opt.dirs);
	var app = createApp(opt);

	var All = {
		app: app,
		opt: opt,
		query: reqQuery.bind(All),
		body: reqBody.bind(All)
	};
	if (opt.global) global.All = All;

	console.info("Plugins:");

	var plugins = [], pluginPath, plugin, lastPath;

	while (pluginPath = opt.plugins.shift()) {
		if (pluginPath.startsWith('/')) {
			console.info("  ", Path.relative(Path.dirname(lastPath || opt.cwd), pluginPath));
		} else {
			lastPath = require.resolve(pluginPath);
			console.info(" ", pluginPath);
		}
		plugin = require(pluginPath);
		if (typeof plugin != "function") return;
		var obj = plugin(opt) || {};
		obj.path = pluginPath;
		obj.plugin = plugin;
		plugins.push(obj);
	}

	All.plugins = plugins;

	All.log = initLog(opt);

	return initPlugins(All).then(function() {
		return initPlugins(All, 'file');
	}).then(function() {
		app.use(filesError);
		app.use(All.log);
		return initPlugins(All, 'service');
	}).then(function() {
		app.use(servicesError);
		return initPlugins(All, 'view');
	}).then(function() {
		app.use(viewsError);
		return All;
	});
}

function initPlugins(All, type) {
	return Promise.all(All.plugins.map(function(obj) {
		if (type && !obj[type]) return;
		if (!type && (obj.file || obj.service || obj.view)) return;
		var to;
		if (obj.name) {
			to = All[obj.name] = All[obj.name] || {};
		} else {
			to = All;
		}
		var p = type && obj[type](All);
		Object.keys(obj.plugin).forEach(function(key) {
			if (to[key] !== undefined) throw new Error(`module conflict ${key}\n ${obj.path}`);
			to[key] = obj.plugin[key];
		});
		return p;
	})).catch(function(err) {
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

function initDirs(dirs) {
	for (var k in dirs) mkdirp.sync(dirs[k]);
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
		next();
	});
	return app;
}

function servicesError(err, req, res, next) {
	var msg = err.message || err.toString();
	var code = parseInt(err.statusCode || err.code);
	if (isNaN(code) || code < 200 || code >= 600) {
		msg += "\nerror code: " + code;
		code = 500;
	}
	if (code >= 500) console.error(err);
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
	if (code >= 500) console.error(err);
	res.redirect(req.app.settings.errorLocation + '?code=' + code);
}

function reqBody(req, res, next) {
	var opt = this.opt;
	bodyParserJson(req, res, function() {
		var obj = req.body;
		obj.site = opt.site || req.hostname;
		next();
	});
}

function reqQuery(req, res, next) {
	var obj = req.query;
	obj.site = this.opt.site || req.hostname;
	next();
}

