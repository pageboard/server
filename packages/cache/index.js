const Upcache = require('upcache');
const { promises: fs } = require('node:fs');
const Path = require('node:path');
const Stringify = require('fast-json-stable-stringify');
const { hash } = require('node:crypto');

module.exports = class CacheModule {
	static name = 'cache';
	#to;

	constructor(app, opts) {
		this.app = app;
		this.metafile = Path.join(app.dirs.data, 'cache.json');
		this.opts = opts;
		opts.wkp = "/.well-known/upcache";
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

	install(req, url) {
		(async () => {
			const obj = new URL(this.opts.wkp, url);
			const controller = new AbortController();
			const toId = setTimeout(() => controller.abort(), 10000);
			try {
				await fetch(obj, {
					method: 'post',
					rejectUnauthorized: false,
					signal: controller.signal
				});
				clearTimeout(toId);
			} catch (err) {
				if (err.name == 'AbortError') {
					console.warn("cache: post timeout", obj.href);
				} else {
					console.error("cache:", err, obj.href);
				}
			}
		})();
	}

	mw(req, res, next) {
		try {
			const tags = [];
			let doSave = false;
			let dobj = this.data;
			if (!dobj) dobj = this.data = {};

			this.hash ??= hash('sha256', Stringify(this.app.opts), 'base64url');

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

