const { pipeline: waitPipeline } = require('node:stream/promises');
const { writeFile } = require('node:fs/promises');
const Path = require('node:path');
const { createWriteStream, promises: fs } = require('node:fs');

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

	viewRoutes(router) {
		this.dom = dom;

		Object.assign(dom.defaults, {
			timeout: 20000
		}, this.opts);

		dom.online.plugins = new Set([
			'console',
			'cookies',
			'form',
			'equivs',
			'languages'
		]);

		Object.assign(dom.plugins, {
			serialize: require('./plugins/serialize'),
			polyfill: require('./plugins/polyfill'),
			nopreload: require('./plugins/nopreload'),
			inlinestyle: require('./plugins/inlinestyle'),
			form: require('./plugins/form'),
			render: require('./plugins/render')
		});
		dom.defaults.cookies.add("bearer");

		router.get(
			'/*',
			async (req, res, next) => this.check(req, res, next),
			this.app.cache.tag('app-:site'),
			(req, res) => this.source(req, res)
		);
	}

	async #checkPath(req, { url }) {
		const { site } = req;
		try {
			const ret = await req.run('page.parse', { url });
			const {
				pathname, lang, ext = 'page'
			} = ret;
			if (pathname == null || !site.$pkg.groups.page.has(ext)) {
				ret.ext = null;
			} else {
				ret.ext = ext;
			}
			if (lang && !site.data.languages?.includes(lang)) {
				ret.lang = null;
			}
			return ret;
		} catch(err) {
			console.info(err);
			return {};
		}
	}

	async check(req, res, next) {
		res.vary('Accept');

		const {
			pathname,
			lang,
			ext
		} = await this.#checkPath(req, { url: req.path });

		if (pathname == null || ext == null) {
			if (req.accepts(['image/*', 'json', 'html']) != 'html') {
				next(new HttpError.NotAcceptable(req.path));
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
				this.#callMw(ext, req, res, next);
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
		pdf.presets.printer.pdfa = true;
		if (!this.#pdfMw) this.#pdfMw = dom(pdf({
			timeout: 120000,
			plugins: ['render']
		})).route((phase, req) => {
			const { visible, location, settings } = phase;
			const { site } = req;
			if (visible) {
				phase.policies = site.$pkg.csps;
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
			}
		});
		return this.#pdfMw(...args);
	}

	#callHtmlMw(...args) {
		if (!this.#htmlMw) this.#htmlMw = dom().route((phase, req, res) => {
			const { site } = req;
			const { settings, visible } = phase;
			if (visible) {
				const { plugins } = settings;
				plugins.add('redirect');
				plugins.add('preloads');
				plugins.add('hidden');
				plugins.add('polyfill');
				plugins.add('serialize');
				settings.equivs = ["X-Upcache-Lock"];
				phase.policies = site.$pkg.csps;
				if (req.res && !req.locked(['webmaster'])) {
					settings.enabled = false;
				}
			}
		});
		return this.#htmlMw(...args);
	}

	#callMailMw(...args) {
		if (!this.#mailMw) this.#mailMw = dom(handler => {
			handler.online.enabled = true;
		}).route((phase, req, res) => {
			const { site } = req;
			const { settings, online, visible } = phase;
			if (visible) {
				const { plugins } = settings;
				plugins.add('nopreload');
				plugins.add('inlinestyle');
				plugins.add('serialize');
				settings.enabled = true;
			} else if (online) {
				// online fully renders, so it needs site CSPs
				phase.policies = site.$pkg.csps;
			}
		});
		return this.#mailMw(...args);
	}

	source(req, res) {
		req.call('cache.map', "/.well-known/source");
		const siteBundle = req.site.$pkg.bundles.get('site');
		const scripts = [];
		const links = [];
		for (const src of siteBundle.scripts ?? []) {
			scripts.push(`<script defer src="${src}" data-bundle="site" data-priority="${siteBundle.priority}"></script>`);
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

	async save(req, { url, path }) {
		const { sql: { Block }, $url } = req;
		if (!$url) {
			throw new HttpError.BadRequest("Rendering needs a site url");
		}
		const {
			ext
		} = await this.#checkPath(req, { url });

		if (!ext) throw new HttpError.NotAcceptable(req.path);

		req.url = url;

		const res = await this.#callMw(ext, req);
		if (res.statusCode != 200) {
			throw HttpError.from(res.statusCode, res.statusText);
		}
		if (!path) {
			path = req.call('statics.file', {
				mount: 'cache',
				name: await Block.genId(9) + '.' + ext
			}).path;
		}
		await fs.mkdir(Path.parse(path).dir, { recursive: true });

		if (res.body) {
			await writeFile(path, res.body);
		} else {
			await waitPipeline(res, createWriteStream(path));
		}
		return {
			path: path,
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
			},
			path: {
				title: 'File path',
				type: 'string',
				format: 'singleline'
			}
		}
	};
};

