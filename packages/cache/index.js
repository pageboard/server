const Upcache = require.lazy('upcache');
const { promises: fs } = require('fs');
const Path = require('path');
const Stringify = require.lazy('fast-json-stable-stringify');
const crypto = require.lazy('crypto');
const got = require.lazy('got');

module.exports = class CacheModule {
	static name = 'cache';
	#to;

	constructor(app, opts) {
		this.app = app;
		if (!opts.file) {
			opts.file = Path.join(app.dirs.data, 'cache.json');
		}
		if (!opts.wkp) {
			opts.wkp = "/.well-known/upcache";
		}
		this.opts = opts;
	}
	map(...args) {
		return Upcache.map(...args);
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
	async apiRoutes(app, server) {
		try {
			this.data = JSON.parse(
				await fs.readFile(this.opts.file, { flag: 'a+' })
			) || {};
		} catch (err) {
			console.error("Cannot read", this.opts.file);
		}
		server.get('*', Upcache.tag('app'));
		server.post(this.opts.wkp, (req, res, next) => {
			this.mw(req, res, next);
		}, (req, res) => {
			res.sendStatus(204);
		});
	}

	#save() {
		if (this.#to) clearTimeout(this.#to);
		this.#to = setTimeout(async () => {
			this.#to = null;
			try {
				await fs.writeFile(this.opts.file, JSON.stringify(this.data));
			} catch (err) {
				console.error("Error writing", err.message, this.opts.file);
			}
		}, 5000);
	}

	install(site) {
		if (!site || !site.url) {
			// app tag invalidation is postponed until an actual site is installed
			return;
		}
		setTimeout(() => {
			const url = new URL(this.opts.wkp, site.url);
			got.post(url, {
				timeout: 5000,
				retry: false,
				https: { rejectUnauthorized: false }
			}).catch((err) => {
				if (err.code == 'ETIMEDOUT') {
					console.warn("cache: post timeout", url.href);
				} else {
					console.error("cache:", err.message, url.href);
				}
			});
		});
	}

	mw(req, res, next) {
		const tags = [];
		let doSave = false;
		let dobj = this.data;
		if (!dobj) dobj = this.data = {};
		// eslint-disable-next-line no-console
		console.info("Check app configuration changes");

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
			// eslint-disable-next-line no-console
			console.info("detected application change");
		}
		tags.push('app-:site');
		this.tag(...tags)(req, res, next);
		if (doSave) this.#save();
	}
};

