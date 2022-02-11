const Path = require('path');
const got = require.lazy('got');
const { pipeline } = require('stream');
const { Pool } = require('tarn');
const { fork } = require('child_process');
const urlFormat = require('url').format;

let pool;

module.exports = class PrerenderModule {
	static name = 'prerender';
	static priority = 0;

	constructor(app, opts) {
		if (opts.workers) opts.workers = parseInt(opts.workers);
		this.opts = Object.assign({
			cacheDir: Path.join(app.dirs.cache, "prerender"),
			stall: 20000,
			allow: "same-origin",
			console: true,
			workers: 2
		}, opts);

		if (opts.develop) {
			opts.cacheModel = "none";
		}
		opts.helpers = [
			'./plugins/extensions'
		];
		opts.plugins = [
			'./plugins/form',
			'./plugins/upcache',
			'./plugins/bearer',
			'./plugins/serialize'
		];
	}

	view(server) {
		const { opts } = this;
		opts.read = {};
		opts.read.helpers = [
			'develop',
			'extensions'
		];

		opts.read.plugins = [
			'form',
			'upcache',
			'httpequivs',
			'bearer'
		];

		server.get(
			'*',
			this.app.cache.tag('app-:site'),
			(req, res, next) => this.prerender(req, res, next)
		);

		const workerPath = Path.join(__dirname, 'worker.js');

		const childOpts = {
			prerender: opts,
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
			min: opts.workers,
			max: 2 * opts.workers
		});

		process.on('exit', () => {
			return pool.destroy();
		});
	}

	#run(config, req, res, next) {
		pool.acquire().promise.then((worker) => {
			worker.on("message", (msg) => {
				if (msg.err) {
					release(worker);
					return next(objToError(msg.err));
				}
				if (msg.locks) this.app.auth.headers(res, msg.locks);
				if (msg.tags) this.app.cache.tag(...msg.tags)(req, res);
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

	#requestedSchema({ site }, { pathname }) {
		const ext = Path.extname(pathname);
		// backward compat for rss
		let type = ext.substring(1) || "page";
		const fake = type == "rss" ? "page" : type;

		if (!site.$pages.includes(fake)) {
			type = 'page';
		} else if (ext.length) {
			pathname = pathname.slice(0, -ext.length);
		}
		if (this.app.api.validate({ type: 'string', format: 'page' }, pathname) === false) {
			pathname = null;
		}
		return {
			type, pathname,
			schema: site.$schema(fake)
		};
	}

	prerender(req, res, next) {
		const site = req.site;
		res.vary('Accept');

		const { pathname, schema, type } = this.#requestedSchema(req, { pathname: req.path });

		if (pathname == null) {
			if (req.accepts(['image/*', 'json', 'html']) != 'html') {
				throw new HttpError.NotFound("Malformed path");
			} else {
				const gs = got.stream(new URL('/.well-known/404', site.url), {
					retry: 0,
					decompress: false,
					throwHttpErrors: false,
					headers: req.headers,
					https: {
						rejectUnauthorized: false
					}
				});
				gs.on('response', (gres) => {
					res.status(404);
				});
				pipeline(gs, res, (err) => {
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
				return res.redirect(urlFormat({ pathname, query }));
			}

			const plugins = this.opts.read.plugins.slice();
			const settings = {
				extensions: {
					allow: false,
					list: []
				}
			};

			const outputOpts = schema.output || {};

			// begin compat (0.7 clients using ext names)
			if (type == "mail" && outputOpts.mime == null) {
				outputOpts.mime = "application/json";
			}
			if (type == "rss" && outputOpts.mime == null) {
				outputOpts.mime = "application/xml";
			}
			/* end compat */

			const { mime = "text/html" } = outputOpts;

			if (site.data.env != "production" && mime == "text/html" && query.develop === undefined) {
				query.develop = null;
			}
			if (query.develop !== undefined) {
				res.set('Content-Security-Policy', "");
				let mapTo;
				if (req.path.startsWith("/.well-known/")) {
					// ends with a status code, not set in develop mode
					mapTo = req.path;
					res.status(req.path.split('/').pop());
				} else {
					mapTo = "/.well-known/200";
				}
				this.app.cache.map(res, mapTo);

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
				if (this.app.env != "development") {
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
			this.#run({
				view: view,
				helpers: this.opts.read.helpers,
				plugins: plugins,
				settings: settings
			}, req, res, next);
		}
	}
};



function objToError(obj) {
	const err = new Error(obj.message);
	err.name = obj.name;
	err.stack = obj.stack;
	err.statusCode = obj.statusCode || 500;
	return err;
}

