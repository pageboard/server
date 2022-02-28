const Upcache = require.lazy('upcache');
const fs = require('fs').promises;
const Path = require('path');
const Stringify = require.lazy('fast-json-stable-stringify');
const crypto = require('crypto');
const got = require.lazy('got');

module.exports = class CacheModule {
	static name = 'cache';
	#to;

	constructor(app, opts) {
		if (!opts.file) {
			opts.file = Path.join(app.dirs.data, 'cache.json');
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
		server.post('/.well-known/upcache', (req, res, next) => {
			this.mw(req, res, next);
		}, (req, res) => {
			res.sendStatus(204);
		});
	}
	async #saveNow() {
		this.#to = null;
		return fs.writeFile(this.path, JSON.stringify(this.data)).catch((err) => {
			console.error("Error writing", this.path);
		});
	}

	#save() {
		if (this.#to) clearTimeout(this.#to);
		this.#to = setTimeout(() => this.#saveNow(), 5000);
	}

	install(site) {
		if (!site) {
			// because it's not possible to post without an actual url
			// app tag invalidation is postponed until an actual site is installed
			return;
		}
		setTimeout(() => {
			if (site.url) got.post(new URL("/.well-known/upcache", site.url), {
				timeout: 5000,
				retry: false,
				https: { rejectUnauthorized: false }
			}).catch((err) => {
				console.error(err);
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
			hash.update(Stringify(this.opt));
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
		this.tag(tags)(req, res, next);
		if (doSave) this.#save();
	}
};

