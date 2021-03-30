const Path = require('path');
const got = require.lazy('got');
const { pipeline } = require('stream');
const { Pool } = require('tarn');
const fork = require('child_process').fork;
const URL = require('url');

var pool;

exports = module.exports = function(opt) {
	if (opt.prerender.workers) opt.prerender.workers = parseInt(opt.prerender.workers);
	opt.prerender = Object.assign({
		cacheDir: Path.join(opt.dirs.cache, "prerender"),
		stall: 20000,
		allow: "same-origin",
		console: true,
		workers: 2
	}, opt.prerender);

	if (opt.develop) {
		opt.prerender.develop = true;
		opt.prerender.cacheModel = "none";
	}

	opt.prerender.helpers = [
		'./plugins/extensions',
		'./plugins/report'
	];
	opt.prerender.plugins = [
		'./plugins/form',
		'./plugins/upcache',
		'./plugins/bearer',
		'./plugins/report',
		'./plugins/serialize'
	];

	return {
		priority: 0,
		view: init
	};
};

function init(All) {
	var opt = All.opt;
	opt.read = {};
	opt.read.helpers = [
		'develop',
		'extensions'
	];

	opt.read.plugins = [
		'form',
		'upcache',
		'httpequivs',
		'bearer'
	];
	if (opt.env != "development") {
		opt.read.helpers.push('report');
	}

	All.app.get(
		'*',
		All.cache.tag('app-:site'),
		prerender
	);

	const workerPath = Path.join(__dirname, 'worker.js');

	const childOpts = {
		prerender: opt.prerender,
		report: opt.report,
		clear: true
	};

	pool = new Pool({
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
		idleTimeoutMillis: 10000,
		min: opt.prerender.workers,
		max: 2 * opt.prerender.workers
	});

	process.on('exit', function() {
		return pool.destroy();
	});
}

function run(config, req, res, next) {
	pool.acquire().promise.then(function(worker) {
		worker.on("message", function(msg) {
			if (msg.err) {
				release(worker);
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
			release(worker, true);
			next(err);
		});
		worker.send({
			view: config.view,
			helpers: config.helpers || [],
			plugins: config.plugins || [],
			settings: config.settings || {},
			mime: config.mime,
			path: req.path,
			protocol: req.protocol,
			query: req.query,
			headers: req.headers,
			cookies: req.cookies,
			xhr: req.xhr
		});
		function release(worker, kill) {
			worker.stdout.removeAllListeners('data');
			worker.removeAllListeners("message");
			worker.removeAllListeners("error");
			if (kill) worker.kill();
			pool.release(worker);
		}
	}).catch(next);
}

function objToError(obj) {
	var err = new Error(obj.message);
	err.name = obj.name;
	err.stack = obj.stack;
	err.statusCode = obj.statusCode || 500;
	return err;
}

function prerender(req, res, next) {
	var opt = All.opt;
	var el = req.site.$schema('page');

	var pattern = el && el.properties.data && el.properties.data.properties.url.pattern;
	if (!pattern) throw new Error("Missing page element missing schema for data.url.pattern");
	var urlRegex = new RegExp(pattern);
	var path = req.path;
	// backward compat
	var ext = Path.extname(path);
	if (ext) {
		ext = ext.substring(1);
		if (ext == "rss") ext = "page"; // feed@0.8 kludge
		var extEl = req.site.$schema(ext);
		if (extEl) {
			el = extEl;
			path = path.slice(0, -ext.length - 1); // urlRegex does not allow extname
		}
	}
	res.vary('Accept');

	if (urlRegex.test(path) == false) {
		if (req.accepts(['json', 'html']) == 'json') {
			throw new HttpError.NotFound("Malformed path");
		} else {
			pipeline(got.stream(req.site.href + '/.well-known/404', {
				retry: 0,
				throwHttpErrors: false
			}), res, function(err) {
				if (err) next(err);
			});
		}
	} else {
		var invalid = false;
		Object.keys(req.query).forEach(function(key) {
			if (/^[a-zA-Z][\w.-]*$/.test(key) === false) {
				invalid = true;
				delete req.query[key];
			}
		});
		if (invalid) return res.redirect(URL.format({
			pathname: path,
			query: req.query
		}));

		var plugins = opt.read.plugins.slice();
		var settings = {
			extensions: {
				allow: false,
				list: []
			}
		};
		// backward compatibility with 0.7 clients using ext names
		if (ext == "mail") settings.mime = "application/json";
		else if (ext == "rss") settings.mime = "application/xml";

		var outputOpts = el.output || {};

		if (req.query.develop !== undefined) {
			All.cache.map(res, '/.well-known/200');
			// FIXME
			// when editor will be loaded alongside the page (and not in an iframe with ?develop)
			// it will make more sense to consolidate write element with page element's csp
			// a very open CSP here
			res.set('Content-Security-Policy', "");
		} else {
			if (outputOpts.pdf) {
				// pdf plugin bypasses serialize
				plugins.push('pdf');
			}
			if (outputOpts.mime) settings.mime = outputOpts.mime;
			if (!outputOpts.medias) {
				settings['auto-load-images'] = false;
				settings.extensions.list.push('js', 'json', 'html', 'xml');
				settings.extensions.allow = true; // whitelist
			} else if (!outputOpts.fonts) {
				settings.extensions.list.push('woff', 'woff2', 'ttf', 'eot', 'otf');
			}
		}
		if (!outputOpts.mime || outputOpts.mime == "text/html") {
			plugins.push('redirect');
			if (opt.env != "development") {
				plugins.unshift('httplinkpreload', 'report');
			}
		}
		if (!outputOpts.display) {
			plugins.push('hide', 'prerender');
		}
		plugins.push('serialize');

		var siteBundle = req.site.$bundles.site.meta;

		var scripts = (siteBundle.scripts || []).map(function(src) {
			return `<script defer src="${src}"></script>`;
		});

		var view = Text`
			<!DOCTYPE html>
			<html>
				<head>
					<title></title>
					${scripts.join('\n')}
				</head>
				<body></body>
			</html>`;
		run({
			view: view,
			helpers: opt.read.helpers,
			plugins: plugins,
			settings: settings
		}, req, res, next);
	}
}
