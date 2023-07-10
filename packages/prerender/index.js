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
	#htmlMw;
	#fullMw;

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

	#requestedRenderingSchema({ site }, { pathname }) {
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
			pathname,
			schema: site.$schema(type)
		};
	}

	check(req, res, next) {
		const { site } = req;
		res.vary('Accept');

		const {
			pathname,
			schema
		} = this.#requestedRenderingSchema(req, { pathname: req.path });

		if (pathname == null || schema == null) {
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
					res.set(subRes.headers);
					pipeline(subRes, res, err => {
						if (err) next(err);
					});
				});
				subReq.end();
				return;
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
				for (const key in query) redUrl.searchParams.append(key, query[key]);
				return res.redirect(redUrl);
			}
		}

		req.schema = schema;

		if (schema.mime == "application/pdf") {
			this.#callPdfMw(req, res, next);
		} else if (!schema.mime || schema.mime == "text/html") {
			this.#callHtmlMw(req, res, next);
		} else {
			this.#callFullMw(req, res, next);
		}
	}

	#callPdfMw(...args) {
		if (!this.#pdfMw) this.#pdfMw = dom(pdf({
			plugins: ['upcache', 'render']
		})).route(({ visible, online, location, settings, policies }, req) => {
			if (visible) {
				const preset = req.query.pdf;
				if (preset != null) {
					location.searchParams.delete('pdf');
				}
				settings.pdf(preset ?? 'printer');
			} else if (online) {
				// pass to next middleware
				cspSchemaToPhase(policies, req.schema.csp);
			}
		});
		return this.#pdfMw(...args);
	}

	#callHtmlMw(...args) {
		if (!this.#htmlMw) this.#htmlMw = dom().route((phase, req, res) => {
			const { site } = req;
			const { settings, online, visible } = phase;
			if (visible) {
				const { plugins } = settings;
				res.type("text/html");
				plugins.add('redirect');
				plugins.add('preloads');
				plugins.add('hidden');
				plugins.add('serialize');
				if (site.data.env == "dev" || !req.locked(['webmaster'])) {
					settings.enabled = false;
				}
			} else if (online) {
				const { groups: {
					code
				} } = /^\.well-known\/(?<code>\d{3})$/.exec(req.path) ?? {
					groups: {}
				};
				if (code) {
					req.call('cache.map', req.path);
					res.status(Number.parseInt(code));
				} else {
					req.call('cache.map', "/.well-known/200");
				}
			}
		});
		return this.#htmlMw(...args);
	}

	#callFullMw(...args) {
		if (!this.#fullMw) this.#fullMw = dom(handler => {
			handler.online.enabled = true;
		}).route((phase, req, res) => {
			const { schema } = req;
			const { settings, policies } = phase;
			if (phase.visible) {
				const { plugins } = settings;
				plugins.add('serialize');
				settings.enabled = true;
			} else if (phase.online) {
				// pass to next middleware
				cspSchemaToPhase(policies, schema.csp);
			}
		});
		return this.#fullMw(...args);
	}

	source({ site }, res) {
		const coreMeta = site.$pkg.bundles.core?.meta;
		const scripts = (coreMeta?.scripts ?? []).map(src => {
			return `<script defer src="${src}" data-priority="${coreMeta.priority}"></script>`;
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


function cspSchemaToPhase(policies, csp) {
	for (const [key, list] of Object.entries(csp)) {
		policies[key] = list.join(' ');
	}
}
