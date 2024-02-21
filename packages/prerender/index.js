const { pipeline } = require('node:stream');
const { pipeline: waitPipeline } = require('node:stream/promises');
const { writeFile, mkdir } = require('node:fs/promises');
const http = require('node:http');
const Path = require('node:path');
const https = require('node:https');
const { createWriteStream } = require('node:fs');
const { createHash } = require('node:crypto');
const dom = require.lazy('express-dom');
const pdf = require.lazy('express-dom-pdf');

module.exports = class PrerenderModule {
	static name = 'prerender';
	static priority = 0;

	#pdfMw;
	#htmlMw;
	#mailMw;

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
			'equivs',
			'languages'
		]);

		Object.assign(dom.plugins, {
			serialize: require('./plugins/serialize'),
			polyfill: require('./plugins/polyfill'),
			nopreload: require('./plugins/nopreload'),
			inlinestyle: require('./plugins/inlinestyle'),
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

	#requestedRenderingSchema(req, { path }) {
		const { site } = req;
		const {
			pathname, lang, ext = 'page'
		} = req.call('page.parse', { url: path });
		const ret = { pathname, schema: null };
		if (!site.$pkg.pages.has(ext)) {
			return ret;
		}
		if (lang && !site.data.languages?.includes(lang)) {
			return ret;
		}
		if (this.app.api.check({
			method: 'page.parse', parameters: { pathname }
		}) === false) {
			// shouldn't req.call be req.run above ?
			return ret;
		}
		ret.schema = site.$schema(ext);
		return ret;
	}

	check(req, res, next) {
		const { site } = req;
		res.vary('Accept');

		const {
			pathname,
			schema
		} = this.#requestedRenderingSchema(req, { path: req.path });

		if (pathname == null || schema == null) {
			if (req.accepts(['image/*', 'json', 'html']) != 'html') {
				throw new HttpError.NotAcceptable("Malformed path");
			} else {
				const url = new URL('/.well-known/404', site.$url);
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
				const redUrl = new URL(pathname, site.$url);
				for (const key in query) redUrl.searchParams.append(key, query[key]);
				return res.redirect(redUrl);
			}
		}

		req.schema = schema;

		if (schema.name == "pdf") {
			this.#callPdfMw(req, res, next);
		} else if (schema.name == "mail") {
			this.#callMailMw(req, res, next);
		} else {
			this.#callHtmlMw(req, res, next);
		}
	}

	#callPdfMw(...args) {
		pdf.presets.prepress.pageCount = true;
		if (!this.#pdfMw) this.#pdfMw = dom(pdf({
			plugins: ['upcache', 'render']
		})).route(({ visible, online, location, settings, policies }, req) => {
			if (visible) {
				// render < equivs < pdf to ensure status is changed after render
				settings.plugins.delete('equivs');
				settings.plugins.add('equivs');
				settings.plugins.delete('pdf');
				settings.plugins.add('pdf');
				const preset = req.query.pdf;
				if (preset != null) {
					location.searchParams.delete('pdf');
				}
				if (preset != "browser") {
					settings.pdf(preset ?? 'screen');
				}
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
				plugins.add('redirect');
				plugins.add('preloads');
				plugins.add('hidden');
				plugins.add('polyfill');
				plugins.add('serialize');
				if (args.length > 1 && site.data.env == "dev" || !req.locked(['webmaster'])) {
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

	#callMailMw(...args) {
		if (!this.#mailMw) this.#mailMw = dom(handler => {
			handler.online.enabled = true;
		}).route((phase, req, res) => {
			const { schema } = req;
			const { settings, policies } = phase;
			if (phase.visible) {
				const { plugins } = settings;
				plugins.add('nopreload');
				plugins.add('inlinestyle');
				plugins.add('serialize');
				settings.enabled = true;
			} else if (phase.online) {
				// pass to next middleware
				cspSchemaToPhase(policies, schema.csp);
			}
		});
		return this.#mailMw(...args);
	}

	source({ site }, res) {
		const core = site.$pkg.bundles.get('core');
		const scripts = (core?.scripts ?? []).map(src => {
			return `<script defer src="${src}" data-priority="${core.priority}"></script>`;
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

	async save(req, data) {
		const { site } = req;
		if (!site.$url) {
			throw new HttpError.BadRequest("Rendering needs a site url");
		}
		const {
			pathname,
			schema
		} = this.#requestedRenderingSchema(req, { path: data.path });

		req.url = data.path;
		req.schema = schema;

		let res, ext;

		if (schema.name == "pdf") {
			ext = 'pdf';
			res = await this.#callPdfMw(req);
		} else if (schema.name == "mail") {
			ext = 'mail';
			res = await this.#callMailMw(req);
		} else {
			ext = 'html';
			res = await this.#callHtmlMw(req);
		}
		if (res.statusCode != 200) {
			throw new HttpError[res.statusCode]();
		}

		const hash = createHash('sha1');
		hash.update(data.path);
		const fileName = hash.digest('base64url') + '.' + ext;
		const dirName = Path.join(this.app.dirs.tmp, site.id);
		await mkdir(dirName, { recursive: true });

		const filePath = Path.join(dirName, fileName);

		if (res.body) await writeFile(filePath, res.body);
		else await waitPipeline(res, createWriteStream(filePath));
		return {
			path: filePath,
			headers: res.headers
		};
	}
	static save = {
		title: 'Save prerendered URL',
		$lock: true,
		$action: 'write',
		required: ['path'],
		properties: {
			path: {
				title: 'Relative URL',
				type: 'string',
				format: 'uri-reference'
			}
		}
	};
};


function cspSchemaToPhase(policies, csp) {
	for (const [key, list] of Object.entries(csp)) {
		policies[key] = list.join(' ');
	}
}
