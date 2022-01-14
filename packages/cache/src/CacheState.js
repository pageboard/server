const fs = require('fs').promises;
const Path = require('path');
const Stringify = require.lazy('fast-json-stable-stringify');
const crypto = require('crypto');
const got = require.lazy('got');

module.exports =
	class CacheState {

		init(All) {
			this.opt = All.opt;
			this.path = Path.join(this.opt.dirs.data, 'cache.json');
			return this.open();
		}
		saveNow() {
			delete this.toSave;
			return fs.writeFile(this.path, JSON.stringify(this.data)).catch((err) => {
				console.error("Error writing", this.path);
			});
		}

		save() {
			if (this.toSave) clearTimeout(this.toSave);
			this.toSave = setTimeout(this.saveNow.bind(this), 5000);
		}

		open() {
			return fs.readFile(this.path, { flag: 'a+' }).then((buf) => {
				const str = buf.toString();
				if (!str) return;
				return JSON.parse(str);
			}).catch((err) => {
				// eslint-disable-next-line no-console
				console.info(`Unparsable ${this.path}, continuing anyway`);
			}).then((data) => {
				this.data = data || {};
			});
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
					retry: false
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
			All.cache.tag.apply(null, tags)(req, res, next);
			if (doSave) this.save();
		}
	};
