var Path = require('path');
var express = require('express');
var morgan = require('morgan');
var rc = require('rc');

exports.config = function(opts) {
	if (!opts) opts = require(process.cwd() + '/package.json');
	return rc(opts.name, {
		env: opts.env || process.env.NODE_ENV || 'development',
		name: opts.name,
		version: opts.version,
		listen: 3000,
		database: `postgres://localhost/${opts.name}`,
		logFormat: ':method :status :response-time ms :url - :res[content-length]',
		statics: {
			maxAge: 0,
			root: process.cwd() + '/public',
			mounts: []
		},
		scope: {
			issuer: opts.name,
			maxAge: 3600 * 12,
			userProperty: 'user'
		},
		plugins: opts.plugins || []
	});
};

exports.init = function(config) {
	var app = createApp(config);

	var api = {
		tag: require('upcache/tag'),
		scope: require('upcache/scope')(config.scope),
		vary: require('upcache/vary')
	};

	var files = [];
	var services = [];
	var views = [];

	config.plugins.forEach(function(plugin) {
		plugin = require(plugin);
		var file = plugin.file && plugin.file(app, api, config);
		if (file) files.push(file);

		var service = plugin.service && plugin.service(app, api, config);
		if (service) services.push(service);

		var view = plugin.view && plugin.view(app, api, config);
		if (view) views.push(view);
	});

	return initPlugins(files, app, api, config).then(function() {
		app.use(filesError);
		app.use(morgan(config.logFormat));
		return initPlugins(services, app, api, config);
	}).then(function() {
		app.use(servicesError);
		return initPlugins(views, app, api, config);
	}).then(function() {
		app.use(viewsError);
		return app;
	});
}

function initPlugins(list, app, api, config) {
	return Promise.all(list.map(function(init) {
		return init(app, api, config);
	}));
}

function createApp(config) {
	var app = express();
	app.set("env", config.env);
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

