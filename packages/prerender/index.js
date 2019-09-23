const Path = require('path');
const { Pool } = require('tarn');
const fork = require('child_process').fork;

module.exports = function(opt) {
	opt.prerender = Object.assign({
		cacheDir: Path.join(opt.dirs.cache, "prerender"),
		stall: 20000,
		allow: "same-origin",
		console: true
	}, opt.prerender);

	if (opt.develop) {
		opt.prerender.develop = true;
		opt.prerender.cacheModel = "none";
	}

	opt.prerender.helpers = [
		'./plugins/report'
	];
	opt.prerender.plugins = [
		'./plugins/form',
		'./plugins/upcache',
		'./plugins/bearer',
		'./plugins/report',
		'./plugins/serialize'
	];

	const workerPath = Path.join(__dirname, 'worker.js');

	const childOpts = {
		prerender: opt.prerender,
		report: opt.report,
		clear: true
	};

	const pool = new Pool({
		validate: function(child) {
			return !child.killed;
		},
		create: function(cb) {
			var child;
			try {
				child = fork(workerPath, {
					detached: true,
					env: process.env,
					stdio: ['ignore', 'pipe', 'inherit', 'ipc']
				});
				child.send(childOpts);
				if (childOpts.clear) delete childOpts.clear;
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
		idleTimeoutMillis: 300000,
		min: 0,
		max: 8
	});
	process.on('exit', function() {
		return pool.destroy();
	});

	All.dom = function(config, req, res, next) {
		pool.acquire().promise.then(function(worker) {
			worker.on("message", function(msg) {
				if (msg.err) {
					return next(objToError(msg.err));
				}
				if (msg.locks) All.auth.headers(res, msg.locks);
				if (msg.tags) All.cache.tag.apply(null, msg.tags)(req, res);
				if (msg.headers != null) {
					for (var k in msg.headers) res.set(k, msg.headers[k]);
				}
				if (msg.attachment != null) {
					res.attachment(msg.attachment);
				}
				if (msg.statusCode) res.status(msg.statusCode);

				if (!msg.piped) {
					release(worker);
					if (msg.body !== undefined) {
						res.send(msg.body);
					} else {
						res.sendStatus(msg.statusCode || 200);
					}
				} else if (msg.finished) {
					release(worker);
					res.end();
				} else {
					worker.stdout.on('data', (data) => {
						res.write(data);
					});
				}
			});
			worker.once("error", function(err) {
				release(true);
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
			function release(kill) {
				worker.stdout.removeAllListeners('data');
				worker.removeAllListeners("message");
				worker.removeAllListeners("error");
				if (kill) worker.kill();
				pool.release(worker);
			}
		}).catch(next);
	};
};


function objToError(obj) {
	var err = new Error(obj.message);
	err.name = obj.name;
	err.stack = obj.stack;
	return err;
}
