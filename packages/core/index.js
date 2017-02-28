var Path = require('path');
var express = require('express');
var morgan = require('morgan');
var prettyBytes = require('pretty-bytes');
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
		logFormat: ':method :status :time :size :type :url',
		plugins: pkgOpt.plugins || [],
		dirs: {
			cache: Path.join(xdg.cache, name),
			data: Path.join(xdg.data, name),
			runtime: Path.join(xdg.runtime, name)
		},
		elements: []
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


	console.info("Plugins:");

	var plugins = [], pluginPath, plugin, lastPath;

	while (pluginPath = opt.plugins.shift()) {
		if (pluginPath.startsWith('/')) {
			console.info("  ", Path.relative(Path.dirname(lastPath || All.cwd), pluginPath));
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

	morgan.token('time', function(req, res) {
		return padFour(morgan['response-time'](req, res, 0)) + 'ms';
	});
	morgan.token('type', function(req, res) {
		return padFour((res.get('Content-Type') || '-').split(';').shift().split('/').pop());
	});
	morgan.token('size', function(req, res) {
		var len = parseInt(res.get('Content-Length'));
		return padFour((len && prettyBytes(len) || '0 B').replace(/ /g, ''));
	});

	return initPlugins(All).then(function() {
		return initPlugins(All, 'file');
	}).then(function() {
		app.use(filesError);
		app.use(morgan(opt.logFormat));
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

function initDirs(dirs) {
	for (var k in dirs) mkdirp.sync(dirs[k]);
}

function padFour(str) {
	return ("    " + str).slice(-4);
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

