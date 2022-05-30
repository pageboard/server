const Path = require('node:path');
const { pipeline } = require('node:stream');
const { format: urlFormat } = require('node:url');
const got = require.lazy('got'); // TODO switch to undici
const dom = require.lazy('express-dom');

module.exports = class PrerenderModule {
	static name = 'prerender';
	static priority = 0;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	viewRoutes(app, server) {
		this.dom = dom;

		Object.assign(dom.settings, {
			timeout: 20000
		}, this.opts);

		dom.settings.load.plugins = [
			'console',
			'form',
			'upcache',
			'equivs',
			'cookies'
		];

		dom.helpers.prerender = (...args) => this.prerender(...args);

		Object.assign(dom.plugins, {
			serialize: require('./plugins/serialize'),
			form: require('./plugins/form'),
			upcache: require('./plugins/upcache'),
			render: require('./plugins/render')
		});
		dom.settings.allowedCookies = new Set(["bearer"]);

		server.get(
			'*',
			app.cache.tag('app-:site'),
			(req, res) => this.check(req, res),
			dom('prerender', 'develop').load()
		);
	}

	#requestedSchema({ site }, { pathname }) {
		const ext = Path.extname(pathname);
		// backward compat for rss
		let type = ext.substring(1) || "page";
		const fake = type == "rss" ? "page" : type;

		if (!site.$pkg.pages.includes(fake)) {
			type = 'page';
		} else if (ext.length) {
			pathname = pathname.slice(0, -ext.length);
		}
		if (this.app.api.validate({
			type: 'string',
			format: 'page'
		}, pathname) === false) {
			pathname = null;
		}
		return {
			type, pathname,
			schema: site.$schema(fake)
		};
	}

	check(req, res, next) {
		const { site } = req;
		res.vary('Accept');

		const {
			pathname,
			schema,
			type
		} = this.#requestedSchema(req, { pathname: req.path });
		req.$fake = { schema, type };

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
		}
	}

	prerender(mw, settings, req, res) {
		const { site, query, $fake: { schema, type } } = req;

		const { plugins } = settings.load;

		const outputOpts = schema.output || {};
		// begin compat (0.7 clients using ext names)
		if (type == "mail" && outputOpts.mime == null) {
			outputOpts.mime = "application/json";
		}
		if (type == "rss" && outputOpts.mime == null) {
			outputOpts.mime = "application/xml";
		}
		/* end compat */

		const { mime = "text/html", pdf, display, medias, fonts } = outputOpts;

		if (mime == "text/html" && site.data.env == "dev" && !pdf) {
			if (query.develop == "prerender") {
				delete query.develop;
			} else if (!query.develop) {
				query.develop = null;
			}
		}

		if (query.develop !== undefined && ![null, "write"].includes(query.develop)) {
			delete query.develop;
		}

		if (query.develop === null) {
			if (req.path.startsWith("/.well-known/")) {
				// ends with a status code, not set in develop mode
				req.call('cache.map', req.path);
				res.status(req.path.split('/').pop());
			} else {
				req.call('cache.map', "/.well-known/200");
			}
		} else {
			settings.location.searchParams.delete('develop');
			settings.mime = mime;
			if (pdf) {
				settings.helpers.push('pdf');
			} else if (medias) {
				settings.policies.img = "'self' https: data:";
				settings.policies.font = "'self' https: data:";
				settings.policies.style = "'self' 'unsafe-inline' https:";
			} else if (fonts) {
				settings.policies.font = "'self' https: data:";
			}
		}
		if (mime == "text/html") {
			plugins.push('redirect');
			if (this.app.env != "development") {
				plugins.unshift('preloads');
			}
		}
		if (!display) {
			plugins.push('hide', 'prerender');
		}
		plugins.push('serialize');

		const siteScripts = site.$pkg.bundles.site?.meta?.scripts ?? [];

		const scripts = siteScripts.map(src => {
			return `<script defer src="${src}"></script>`;
		});

		settings.input = Text`
			<!DOCTYPE html>
			<html>
				<head>
					<title></title>
					${scripts.join('\n')}
				</head>
				<body></body>
			</html>`;
	}
};
