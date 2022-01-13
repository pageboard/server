const Path = require('path');
const got = require.lazy('got');
const { pipeline } = require('stream');
const { Pool } = require('tarn');
const fork = require('child_process').fork;
const URL = require('url');

let pool;

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
		'./plugins/extensions'
	];
	opt.prerender.plugins = [
		'./plugins/form',
		'./plugins/upcache',
		'./plugins/bearer',
		'./plugins/serialize'
	];

	return {
		priority: 0,
		view: init
	};
};

function init(All) {
	const opt = All.opt;
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

	All.app.get(
		'*',
		All.cache.tag('app-:site'),
		prerender
	);

	const workerPath = Path.join(__dirname, 'worker.js');

	const childOpts = {
		prerender: opt.prerender,
		clear: true
	};

	pool = new Pool({
		validate: function(child) {
			return !child.killed;
		},
		create: function(cb) {
			let child;
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

	process.on('exit', () => {
		return pool.destroy();
	});
}

function run(config, req, res, next) {
	pool.acquire().promise.then((worker) => {
		worker.on("message", (msg) => {
			if (msg.err) {
				release(worker);
				return next(objToError(msg.err));
			}
			if (msg.locks) All.auth.headers(res, msg.locks);
			if (msg.tags) All.cache.tag.apply(null, msg.tags)(req, res);
			if (msg.headers != null) {
				for (const k in msg.headers) res.set(k, msg.headers[k]);
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
		worker.once("error", (err) => {
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
	const err = new Error(obj.message);
	err.name = obj.name;
	err.stack = obj.stack;
	err.statusCode = obj.statusCode || 500;
	return err;
}

function prerender(req, res, next) {
	const opt = All.opt;
	const site = req.site;
	let el = site.$schema('page');

	const pattern = el && el.properties.data && el.properties.data.properties.url.pattern;
	if (!pattern) throw new Error("Missing page element missing schema for data.url.pattern");
	const urlRegex = new RegExp(pattern);
	let pathname = req.path;
	// backward compat
	let ext = Path.extname(pathname);
	if (ext) {
		ext = ext.substring(1);
		if (ext == "rss") ext = "page"; // feed@0.8 kludge
		const extEl = site.$schema(ext);
		if (extEl) {
			el = extEl;
			pathname = pathname.slice(0, -ext.length - 1); // urlRegex does not allow extname
		}
	}
	res.vary('Accept');

	if (urlRegex.test(pathname) == false) {
		if (req.accepts(['json', 'html']) == 'json') {
			throw new HttpError.NotFound("Malformed path");
		} else {
			pipeline(got.stream(site.href + '/.well-known/404', {
				retry: 0,
				throwHttpErrors: false
			}), res, (err) => {
				if (err) next(err);
			});
		}
	} else {
		const { query } = req;
		let invalid = false;
		Object.keys(query).forEach((key) => {
			if (/^[a-zA-Z][\w.-]*$/.test(key) === false) {
				invalid = true;
				delete query[key];
			}
		});
		if (invalid) {
			return res.redirect(URL.format({ pathname, query }));
		}

		const plugins = opt.read.plugins.slice();
		const settings = {
			extensions: {
				allow: false,
				list: []
			}
		};
		// backward compatibility with 0.7 clients using ext names
		if (ext == "mail") settings.mime = "application/json";
		else if (ext == "rss") settings.mime = "application/xml";

		const outputOpts = el.output || {};
		const { mime = "text/html" } = outputOpts;

		if (site.data.env != "production" && mime == "text/html" && query.develop === undefined) {
			query.develop = null;
		}
		if (query.develop !== undefined) {
			All.cache.map(res, '/.well-known/200');
			res.set('Content-Security-Policy', "");
		} else {
			if (outputOpts.pdf) {
				// pdf plugin bypasses serialize
				plugins.push('pdf');
			}
			settings.mime = mime;
			if (!outputOpts.medias) {
				settings['auto-load-images'] = false;
				settings.extensions.list.push('js', 'json', 'html', 'xml');
				settings.extensions.allow = true; // whitelist
			} else if (!outputOpts.fonts) {
				settings.extensions.list.push('woff', 'woff2', 'ttf', 'eot', 'otf');
			}
		}
		if (mime == "text/html") {
			plugins.push('redirect');
			if (opt.env != "development") {
				plugins.unshift('httplinkpreload');
			}
		}
		if (!outputOpts.display) {
			plugins.push('hide', 'prerender');
		}
		plugins.push('serialize');

		const siteBundle = site.$bundles.site.meta;

		const scripts = (siteBundle.scripts || []).map((src) => {
			return `<script defer src="${src}"></script>`;
		});

		const view = Text`
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
