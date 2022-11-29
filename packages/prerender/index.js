const Path = require('node:path');
const { pipeline } = require('node:stream');
const http = require('http');
const https = require('https');
const dom = require.lazy('express-dom');
const pdf = require.lazy('express-dom-pdf');

module.exports = class PrerenderModule {
	static name = 'prerender';
	static priority = 0;

	#pdfMw;
	#domMw;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	prerendering(req) {
		return req.get(dom.header) != null;
	}

	viewRoutes(app, server) {
		this.dom = dom;

		Object.assign(dom.defaults, {
			timeout: 20000
		}, this.opts);

		dom.online.plugins = new Set([
			'console',
			'cookies',
			'form',
			'upcache',
			'equivs'
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
			(req, res, next) => this.check(req, res, next),
			(req, res, next) => this.source(req, res, next)
		);
	}

	#callPdfMw(...args) {
		if (!this.#pdfMw) this.#pdfMw = dom(pdf({
			plugins: ['upcache', 'render']
		})).route(({ location, settings }, req) => {
			const preset = req.query.pdf;
			if (preset != null) {
				location.searchParams.delete('pdf');
			}
			settings.pdf(preset ?? 'printer');
		});
		return this.#pdfMw(...args);
	}

	#callDomMw(...args) {
		if (!this.#domMw) this.#domMw = dom().route(
			(phase, req, res) => this.prerender(phase, req, res)
		);
		return this.#domMw(...args);
	}

	#requestedSchema({ site }, { pathname }) {
		const ext = Path.extname(pathname);
		let type = ext.substring(1) || "page";

		if (!site.$pkg.pages.includes(type)) {
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
			schema: site.$schema(type)
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

		if (pathname == null) {
			if (req.accepts(['image/*', 'json', 'html']) != 'html') {
				throw new HttpError.NotFound("Malformed path");
			} else {
				const url = new URL('/.well-known/404', site.url);
				const agent = url.protocol == "https:" ? https : http;
				const subReq = agent.request(url, {
					headers: req.headers,
					rejectUnauthorized: false
				}, subRes => {
					res.status(404);
					pipeline(subRes, res, err => {
						if (err) next(err);
					});
				});
				subReq.end();
			}
		} else {
			const { query } = req;
			let invalid = false;
			Object.keys(query).forEach(key => {
				if (/^[a-zA-Z][\w.-]*$/.test(key) === false) {
					invalid = true;
					delete query[key];
				}
			});
			if (invalid) {
				const redUrl = new URL(pathname, site.url);
				redUrl.searchParams = new URLSearchParams(query);
				return res.redirect(redUrl);
			}
		}

		const { output = {} } = schema;
		// begin compat (0.7 clients using ext names)
		if (type == "mail" && output.mime == null) {
			output.mime = "application/json";
		}
		if (type == "rss" && output.mime == null) {
			output.mime = "application/xml";
		}
		/* end compat */
		req.output = output;

		const { pdf } = output;
		if (pdf) {
			this.#callPdfMw(req, res, next);
		} else {
			this.#callDomMw(req, res, next);
		}
	}

	prerender(phase, req, res) {
		const { site, output } = req;
		delete req.output;
		const { mime = "text/html", medias, fonts } = output;

		const { location, settings, policies } = phase;
		const { plugins } = settings;

		res.type(mime);
		if (mime == "text/html") {
			plugins.add('redirect');
			plugins.add('preloads');
		}
		plugins.add('hidden');
		plugins.add('serialize');

		if (phase.visible) {
			if (mime == "text/html" && (site.data.env == "dev" || !req.locked(['webmaster']))) {
				settings.enabled = false;
			}
			if (req.query.develop !== undefined) {
				location.searchParams.delete('develop');
				if (req.query.develop == "render") {
					settings.enabled = true;
				} else {
					settings.enabled = false;
				}
			}
		} else if (phase.online) {
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
			if (medias) {
				policies.img = "'self' https: data:";
				policies.style = "'self' 'unsafe-inline' https:";
			}
			if (fonts) {
				policies.font = "'self' https: data:";
			}
		}
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
