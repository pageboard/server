const Path = require('path');
const { Pool } = require('tarn');
const fork = require('child_process').fork;

module.exports = function(opt) {
	opt.prerender = {};

	opt.prerender.helpers = [];
	opt.prerender.plugins = [
		'./plugins/form',
		'./plugins/bearer'
	];

	opt.prerender.settings = {
		cacheDir: Path.join(opt.dirs.cache, "prerender"),
		stall: 20000,
		allow: "same-origin",
		console: true
	};
	if (opt.develop) {
		opt.prerender.settings.develop = true;
		opt.prerender.settings.cacheModel = "none";
	}

	const workerPath = Path.join(__dirname, 'worker.js');

	const pool = new Pool({
		validate: function(child) {
			return !child.killed;
		},
		create: function(cb) {
			var child;
			try {
				child = fork(workerPath, {
					detached: true,
					env: process.env
				});
				child.send({
					prerender: opt.prerender,
					report: opt.report
				});
			} catch(ex) {
				cb(ex);
				return;
			}
			cb(null, child);
		},
		destroy: function(child) {
			if (!child.killed) child.kill();
		},
		acquireTimeoutMillis: 5000,
		min: 2,
		max: 8
	});
	process.on('exit', function() {
		return pool.destroy();
	});

	All.dom = function(config, req, res, next) {
		pool.acquire().promise.then(function(worker) {
			worker.once("message", function(obj) {
				worker.removeAllListeners("error");
				pool.release(worker);
				if (obj.err) {
					return next(objToError(obj.err));
				}
				if (obj.locks) All.auth.headers(res, obj.locks);
				if (obj.tags) All.cache.tag.apply(null, obj.tags)(req, res);
				if (obj.headers != null) {
					for (var k in obj.headers) res.set(k, obj.headers[k]);
				}
				if (obj.code != null) {
					if (obj.body === undefined) res.sendStatus(obj.code);
					else res.status(obj.code);
				}
				if (obj.body !== undefined) res.send(obj.body);
			});
			worker.once("error", function(err) {
				worker.removeAllListeners("message");
				worker.kill();
				pool.release(worker);
				next(err);
			});
			worker.send({
				view: config.view,
				helpers: config.helpers || [],
				plugins: config.plugins || [],
				path: req.path,
				protocol: req.protocol,
				query: req.query,
				headers: req.headers,
				cookies: req.cookies,
				xhr: req.xhr
			});
		}).catch(function(err) {
			console.error(err);
			next(err);
		});
	};
};


function objToError(obj) {
	var err = new Error(obj.message);
	err.name = obj.name;
	err.stack = obj.stack;
	return err;
}
