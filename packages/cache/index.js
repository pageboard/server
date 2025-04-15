const { promises: fs } = require('node:fs');
const Path = require('node:path');

const Stringify = require.lazy('fast-json-stable-stringify');
const Upcache = require.lazy('upcache');

const { hash } = require('../../src/utils');

module.exports = class CacheModule {
	static name = 'cache';
	#to;

	constructor(app, opts) {
		this.app = app;
		this.metafile = Path.join(app.dirs.data, 'cache.json');
		this.opts = opts;
		opts.wkp = "/.well-known/upcache";
	}
	async init() {
		this.hash = await hash(Stringify(this.app.opts));
	}
	map({ res }, to) {
		return Upcache.map(res, to);
	}
	tag(...args) {
		return Upcache.tag(...args);
	}
	for(...args) {
		return Upcache.tag.for(...args);
	}
	disable(...args) {
		return Upcache.tag.disable(...args);
	}

	async siteRoutes(router) {
		try {
			this.data = JSON.parse(
				await fs.readFile(this.metafile)
			);
		} catch {
			console.error("Cannot read", this.metafile);
		} finally {
			if (!this.data) this.data = {};
		}
		console.info("cache:", this.opts.enable ? 'enabled' : 'disabled');
		if (!this.opts.enable) {
			router.get('/*', this.disable());
		}
		// all routes must have a app tag
		router.get('/*', Upcache.tag('app'));
		router.post(this.opts.wkp, (req, res, next) => this.mw(req, res, next));
	}

	async invalidate(req, data) {
		if (!req.$url) {
			if (req.site) console.warn("Cannot invalidate cache for site", req.site.id);
			return;
		}
		const url = new URL(this.opts.wkp, req.$url);
		const controller = new AbortController();
		const toId = setTimeout(() => controller.abort(), 15000);
		try {
			await fetch(url, {
				method: 'post',
				rejectUnauthorized: false,
				signal: controller.signal
			});
			clearTimeout(toId);
		} catch (err) {
			if (err.name == 'AbortError') {
				console.warn("cache: post timeout", url.href);
			} else {
				console.info("cache:", err, url.href);
			}
		}
	}
	static invalidate = {
		title: 'Invalidate site cache',
		$private: true
	};

	#save() {
		if (this.#to) clearTimeout(this.#to);
		this.#to = setTimeout(async () => {
			this.#to = null;
			try {
				await fs.writeFile(this.metafile, JSON.stringify(this.data));
			} catch (err) {
				console.error("Error writing", err.message, this.metafile);
			}
		}, 5000);
	}

	mw(req, res, next) {
		try {
			const tags = [];
			let doSave = false;
			let dobj = this.data;
			if (!dobj) dobj = this.data = {};

			if (dobj.hash === undefined) {
				doSave = true;
				dobj.hash = this.hash;
			} else if (dobj.hash != this.hash) {
				doSave = true;
				dobj.hash = this.hash;
				tags.push('app');
				console.info("cache changes app tag");
			}
			tags.push('app-:site');
			this.tag(...tags)(req, res);
			if (doSave) this.#save();
			res.sendStatus(204);
		} catch (err) {
			next(err);
		}
	}
};

