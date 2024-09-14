const Upcache = require('upcache');
const { promises: fs } = require('node:fs');
const Path = require('node:path');
const Stringify = require('fast-json-stable-stringify');
const crypto = require('node:crypto');

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
	init(app, server) {
		console.info("cache:", this.opts.enable ? 'enabled' : 'disabled');
		if (!this.opts.enable) {
			server.get('*', this.disable());
		}
		// all routes must have a app tag
		server.get('*', Upcache.tag('app'));
	}
	async apiRoutes(app, server) {
		try {
			this.data = JSON.parse(
				await fs.readFile(this.metafile)
			);
		} catch {
			console.error("Cannot read", this.metafile);
		} finally {
			if (!this.data) this.data = {};
		}
		app.post(this.opts.wkp, req => this.mw(req));
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

	install(site) {
		if (site?.$url?.protocol == "http:") {
			// didn't go through a proxy
			return;
		}
		if (!site?.$url) {
			console.info("No url to invalidate the cache", site?.id);
			return;
		}
		setTimeout(async () => {
			const url = new URL(this.opts.wkp, site.$url);
			const controller = new AbortController();
			const toId = setTimeout(() => controller.abort(), 10000);
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
					console.error("cache:", err, url.href);
				}
			}
		});
	}

	mw(req) {
		const tags = [];
		let doSave = false;
		let dobj = this.data;
		if (!dobj) dobj = this.data = {};

		if (!this.hash) {
			const hash = crypto.createHash('sha256');
			hash.update(Stringify(this.app.opts));
			this.hash = hash.digest('hex');
		}
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
		this.tag(...tags)(req, req.res);
		if (doSave) this.#save();
	}
};

