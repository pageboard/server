var requireAll = require('require-all');
var http = require('http');
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
			path: './public',
			maxAge: 0
		},
		scope: {
			issuer: opts.name,
			maxAge: 3600 * 12,
			userProperty: 'user'
		}
	});
};

exports.init = function(config) {
	var app = createApp(config);

	var server = http.createServer(app);
	server.listen(config.listen);

	process.title = config.appname;
	process.on('uncaughtException', function(err) {
		console.error(err);
	});
	console.info(`http://localhost:${config.listen}`);

	var api = {
		tag: require('upcache/tag'),
		scope: require('upcache/scope')(config.scope),
		vary: require('upcache/vary'),
		db: require('./db')(config)
	};

	routes('files', app, config, api);
	app.use(filesError);

	app.use(morgan(config.logFormat));

	routes('api', app, config, api);
	app.use(apiError);

	routes('views', app, config, api);
	app.use(viewsError);
}

function routes(dir, app, config, api) {
	Object.assign(api, requireAll({
		dirname: __dirname + '/' + dir,
		resolve: function(mod) {
			if (mod.route) {
				mod.route(app, api, config);
				delete mod.route;
			}
			return mod;
		}
	}));
}

function createApp(config) {
	var app = express();
	app.set("env", config.env);
	app.set('views', config.statics.path);
	app.disable('x-powered-by');
	return app;
}

function apiError(err, req, res, next) {
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

