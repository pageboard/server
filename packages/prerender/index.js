const { pipeline: waitPipeline } = require('node:stream/promises');
const { writeFile } = require('node:fs/promises');
const Path = require('node:path');
const { createWriteStream } = require('node:fs');
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
			async (req, res, next) => this.check(req, res, next),
			app.cache.tag('app-:site'),
			(req, res) => this.source(req, res)
		);
	}

	async #requestedRenderingSchema(req, { url }) {
		const { site } = req;
		try {
			const ret = await req.run('page.parse', { url });
			const {
				pathname, lang, ext = 'page'
			} = ret;
			ret.schema = null;
			if (pathname == null || !site.$pkg.pages.has(ext)) {
				return ret;
			}
			if (lang && !site.data.languages?.includes(lang)) {
				ret.lang = null;
				return ret;
			}
			ret.schema = site.$schema(ext);
			return ret;
		} catch {
			return {};
		}
	}

	async check(req, res, next) {
		res.vary('Accept');

		const {
			pathname,
			schema,
			lang,
			ext
		} = await this.#requestedRenderingSchema(req, { url: req.path });

		if (pathname == null || schema == null) {
			if (req.accepts(['image/*', 'json', 'html']) != 'html') {
				next(new HttpError.NotAcceptable());
			} else {
				req.call('cache.map', "/.well-known/statics/410.html");
				res.set('X-Accel-Redirect', "/.well-known/statics/410.html");
				res.status(410);
				res.removeHeader('Content-Type');
				res.end();
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
				const redUrl = req.call('page.format', {
					url: pathname, lang, ext
				});
				for (const key in query) redUrl.searchParams.append(key, query[key]);
				res.redirect(redUrl);
			} else {
				req.schema = schema;
				this.#callMw(schema.name, req, res, next);
			}
		}
	}

	#callMw(name, req, res, next) {
		if (name == "pdf") {
			return this.#callPdfMw(req, res, next);
		} else if (name == "mail") {
			return this.#callMailMw(req, res, next);
		} else {
			return this.#callHtmlMw(req, res, next);
		}
	}

	#callPdfMw(...args) {
		pdf.presets.prepress.pageCount = true;
		if (!this.#pdfMw) this.#pdfMw = dom(pdf({
			timeout: 120000,
			plugins: ['upcache', 'render']
		})).route(({ visible, online, location, settings, policies }, req) => {
			if (visible) {
				// render < equivs < pdf to ensure status is changed after render
				settings.plugins.delete('equivs');
				settings.plugins.add('equivs');
				settings.plugins.delete('pdf');
				settings.plugins.add('pdf');
				const preset = location.searchParams.get('pdf');
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
			const { site, schema } = req;
			const { settings, online, visible, policies } = phase;
			if (visible) {
				// full render
				const { plugins } = settings;
				plugins.add('redirect');
				plugins.add('preloads');
				plugins.add('hidden');
				plugins.add('polyfill');
				plugins.add('serialize');
				if (res.req && (site.data.env == "dev" || !req.locked(['webmaster']))) {
					// manual response does not have req
					settings.enabled = false;
				}
			} else if (online) {
				cspSchemaToPhase(policies, schema.csp);
			}
		});
		return this.#htmlMw(...args);
	}

	#callMailMw(...args) {
		if (!this.#mailMw) this.#mailMw = dom(handler => {
			handler.online.enabled = true;
		}).route((phase, req, res) => {
			const { schema } = req;
			const { settings, online, visible, policies } = phase;
			if (visible) {
				const { plugins } = settings;
				plugins.add('nopreload');
				plugins.add('inlinestyle');
				plugins.add('serialize');
				settings.enabled = true;
			} else if (online) {
				// pass to next middleware
				cspSchemaToPhase(policies, schema.csp);
			}
		});
		return this.#mailMw(...args);
	}

	source(req, res) {
		req.call('cache.map', "/.well-known/source");
		const core = req.site.$pkg.bundles.get('core');
		const scripts = [];
		const links = [];
		for (const src of core?.scripts ?? []) {
			scripts.push(`<script defer src="${src}" data-priority="${core.priority}"></script>`);
			links.push(`<${src}>;rel=preload;as=script`);
		}
		res.type('text/html');
		res.set('Link', links.join(','));
		const { lang } = req.call(
			'translate.lang',
			req.call('page.parse', { url: req.path })
		);
		res.send(Text`
			<!DOCTYPE html>
			<html lang="${lang}">
				<head>
					<title></title>
					${scripts.join('\n')}
				</head>
				<body></body>
			</html>`);
	}

	async save(req, { url }) {
		const { site } = req;
		if (!site.$url) {
			throw new HttpError.BadRequest("Rendering needs a site url");
		}
		const {
			schema
		} = await this.#requestedRenderingSchema(req, { url });

		req.url = url;
		req.schema = schema;

		const ext = schema.name;
		const res = await this.#callMw(ext, req);
		if (res.statusCode != 200) {
			throw new HttpError[res.statusCode]();
		}
		const dirName = req.call('statics.dir', '@tmp');
		const fileName = await req.Block.genId(9);
		const filePath = Path.join(dirName, fileName + '.' + ext);

		if (res.body) {
			await writeFile(filePath, res.body);
		} else {
			await waitPipeline(res, createWriteStream(filePath));
		}
		return {
			path: filePath,
			headers: res.headers
		};
	}
	static save = {
		title: 'Save',
		$private: true,
		$action: 'write',
		required: ['url'],
		properties: {
			url: {
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
