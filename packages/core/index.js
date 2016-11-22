var Path = require('path');
var express = require('express');
var morgan = require('morgan');
var rc = require('rc');
var mkdirp = require('mkdirp');
var xdg = require('xdg-basedir');

// exceptional but so natural
global.HTTPError = require('http-errors');

exports.config = function(pkgOpt) {
	if (!pkgOpt) pkgOpt = require(process.cwd() + '/package.json');
	var name = pkgOpt.name;
	var opt = rc(name, {
		env: pkgOpt.env || process.env.NODE_ENV || 'development',
		name: name,
		version: pkgOpt.version,
		global: true,
		listen: 3000,
		database: `postgres://localhost/${name}`,
		logFormat: ':method :status :response-time ms :url - :res[content-length]',
		statics: {
			maxAge: 0,
			root: process.cwd() + '/public',
			mounts: []
		},
		scope: {
			issuer: name,
			maxAge: 3600 * 12,
			userProperty: 'user'
		},
		plugins: pkgOpt.plugins || [],
		dirs: {
			cache: Path.join(xdg.cache, name),
			config: Path.join(xdg.config, name),
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
		opt: opt
	};
	if (opt.global) global.All = All;

	var files = [];
	var services = [];
	var views = [];

	console.info("plugins:\n", opt.plugins.join("\n "));

	opt.plugins.forEach(function(path) {
		if (path.startsWith('./')) path = Path.join(process.cwd(), path);
		var plugin = require(path);
		if (typeof plugin != "function") return;
		var obj = plugin(opt) || {};
		var to;
		if (obj.name) {
			to = All[obj.name] = All[obj.name] || {};
		} else {
			to = All;
		}
		Object.keys(plugin).forEach(function(key) {
			if (to[key] !== undefined) throw new Error(`module conflict ${key}\n ${path}`);
		});
		if (obj.file) files.push(obj.file);
		if (obj.service) services.push(obj.service);
		if (obj.view) views.push(obj.view);
	});

	return initPlugins(files, All).then(function() {
		app.use(filesError);
		app.use(morgan(opt.logFormat));
		return initPlugins(services, All);
	}).then(function() {
		app.use(servicesError);
		return initPlugins(views, All);
	}).then(function() {
		app.use(viewsError);
		return app;
	});
}

function initPlugins(list, All) {
	return Promise.all(list.map(function(init) {
		return init(All);
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

