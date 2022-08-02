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

		Object.assign(dom.defaults, {
			timeout: 20000
		}, this.opts);

		dom.online.plugins = new Set([
			'console',
			'form',
			'upcache',
			'equivs',
			'cookies'
		]);

		Object.assign(dom.plugins, {
			serialize: require('./plugins/serialize'),
			form: require('./plugins/form'),
			upcache: require('./plugins/upcache'),
			render: require('./plugins/render')
		});
		dom.defaults.cookies.add("bearer");

		server.get(
			'*',
			app.cache.tag('app-:site'),
			(req, res) => this.check(req, res),
			dom((...args) => this.prerender(...args)),
			(req, res, next) => this.source(req, res, next)
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

	prerender(settings, req, res) {
		const { site, query, $fake: { schema = {}, type } } = req;

		const outputOpts = schema.output ?? {};
		// begin compat (0.7 clients using ext names)
		if (type == "mail" && outputOpts.mime == null) {
			outputOpts.mime = "application/json";
		}
		if (type == "rss" && outputOpts.mime == null) {
			outputOpts.mime = "application/xml";
		}
		/* end compat */

		const { mime = "text/html", pdf, display, medias, fonts } = outputOpts;

		const { plugins, policies } = settings.online;

		if (mime == "text/html" && site.data.env == "dev" && !pdf) {
			if (query.develop === "prerender") {
				delete query.develop;
				settings.location.searchParams.delete('develop');
			} else if (query.develop == null) {
				settings.location.searchParams.set('develop', '');
			}
		}

		if (query.develop !== undefined && !["", "write", "on", "off"].includes(query.develop)) {
			delete query.develop;
			settings.location.searchParams.delete('develop');
		}

		if (query.develop === "") {
			const { groups: {
				code
			}} = /^\.well-known\/(?<code>\d{3})$/.exec(req.path) ?? {
				groups: {}
			};
			if (code) {
				// ends with a status code, not set in develop mode
				req.call('cache.map', req.path);
				res.status(Number.parseInt(code));
			} else {
				req.call('cache.map', "/.well-known/200");
			}
		} else if (pdf) {
			return this.app.pdf.helper(settings, req, res);
		} else if (medias) {
			policies.img = "'self' https: data:";
			policies.font = "'self' https: data:";
			policies.style = "'self' 'unsafe-inline' https:";
		} else if (fonts) {
			policies.font = "'self' https: data:";
		}

		res.type(mime);
		if (mime == "text/html") {
			plugins.add('redirect');
			plugins.add('preloads');
		}
		if (!display) {
			plugins.add('hidden');
		}
		plugins.add('serialize');
	}

	source({ site }, res) {
		const siteScripts = site.$pkg.bundles.site?.meta?.scripts ?? [];
		const scripts = siteScripts.map(src => {
			return `<script defer src="${src}"></script>`;
		});
		res.type('text/html');
		res.send(Text`
			<!DOCTYPE html>
			<html>
				<head>
					<title></title>
					${scripts.join('\n')}
				</head>
				<body></body>
			</html>`);
	}
};
