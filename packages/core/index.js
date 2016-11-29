var Path = require('path');
var express = require('express');
var morgan = require('morgan');
var rc = require('rc');
var mkdirp = require('mkdirp');
var xdg = require('xdg-basedir');

// exceptional but so natural
global.HttpError = require('http-errors');

exports.config = function(pkgOpt) {
	pkgOpt = Object.assign({}, require(process.cwd() + '/package.json'), pkgOpt);
	var name = pkgOpt.name;
	var opt = rc(name, {
		env: pkgOpt.env || process.env.NODE_ENV || 'development',
		name: name,
		site: null,
		version: pkgOpt.version,
		global: true,
		listen: 3000,
		logFormat: ':method :status :response-time ms :url - :res[content-length]',
		plugins: pkgOpt.plugins || [],
		dirs: {
			cache: Path.join(xdg.cache, name),
			data: Path.join(xdg.data, name),
			runtime: Path.join(xdg.runtime, name)
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
		cwd: process.cwd()
	};
	if (opt.global) global.All = All;


	console.info("plugins:");

	var plugins = [], pluginPath, plugin;

	while (pluginPath = opt.plugins.shift()) {
		if (pluginPath.startsWith('/')) pluginPath = Path.relative(All.cwd, pluginPath);
		console.info(" ", pluginPath);
		plugins.push(pluginPath);
		plugin = require(pluginPath);
		if (typeof plugin != "function") return;
		var obj = plugin(opt) || {};
		obj.path = pluginPath;
		obj.plugin = plugin;
		plugins.push(obj);
	}

	All.plugins = plugins;

	return initPlugins('file', All).then(function() {
		app.use(filesError);
		app.use(morgan(opt.logFormat));
		return initPlugins('service', All);
	}).then(function() {
		app.use(servicesError);
		return initPlugins('view', All);
	}).then(function() {
		app.use(viewsError);
		return All;
	});
}

function initPlugins(type, All) {
	return Promise.all(All.plugins.map(function(obj) {
		if (!obj[type]) return;
		var p = obj[type](All);
		var to;
		if (obj.name) {
			to = All[obj.name] = All[obj.name] || {};
		} else {
			to = All;
		}
		Object.keys(obj.plugin).forEach(function(key) {
			if (to[key] !== undefined) throw new Error(`module conflict ${key}\n ${obj.path}`);
			to[key] = obj.plugin[key];
		});
		return p;
	})).catch(function(err) {
		console.error(err);
	});
}

function initDirs(dirs) {
	for (var k in dirs) mkdirp.sync(dirs[k]);
}

function createApp(opt) {
	var app = express();
	app.set("env", opt.env);
	app.disable('x-powered-by');
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
	if (code >= 500) console.error(err);
	res.sendStatus(code);
}

function viewsError(err, req, res, next) {
	var code = parseInt(err.statusCode || err.code);
	if (isNaN(code) || code < 200 || code >= 600) {
		code = 500;
	}
	if (code >= 500) console.error(err);
	res.redirect(req.app.settings.errorLocation + '?code=' + code);
}

