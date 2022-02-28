const Upcache = require.lazy('upcache');
const Path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');
const generateKeyPair = promisify(require('crypto').generateKeyPair);

module.exports = class AuthModule {
	static name = 'auth';
	static priority = -10;
	static plugins = [Path.join(__dirname, 'services', 'login')];

	#lock;

	constructor(app, opts) {
		this.app = app;
		this.opts = Object.assign({
			maxAge: 60 * 60 * 24 * 31,
			userProperty: 'user',
			keysize: 2048
		}, opts);
	}

	async apiRoutes(app, server) {
		const keys = await this.#keygen(
			Path.join(this.app.dirs.data, 'keys.json')
		);
		Object.assign(this.opts, keys);
		this.#lock = Upcache.lock(this.opts);
		server.use(this.#lock.init);
	}

	vary() {
		return this.#lock.vary();
	}

	cookie({ site, user }) {
		return {
			value: this.#lock.sign(user, Object.assign({
				hostname: site.url.hostname
			}, this.opts)),
			maxAge: this.opts.maxAge * 1000
		};
	}

	async #keygen(keysPath) {
		let keys;
		try {
			const buf = await fs.readFile(keysPath);
			keys = JSON.parse(buf.toString());
		} catch (err) {
			keys = await generateKeyPair('rsa', {
				modulusLength: 4096,
				publicKeyEncoding: {
					type: 'pkcs1',
					format: 'pem'
				},
				privateKeyEncoding: {
					type: 'pkcs1',
					format: 'pem'
				}
			});
			await fs.writeFile(keysPath, JSON.stringify(keys), {
				mode: 0o600
			});
		}
		// deal with old format
		if (keys.public) {
			keys.publicKey = keys.public;
			delete keys.public;
		}
		if (keys.private) {
			keys.privateKey = keys.private;
			delete keys.private;
		}
		return keys;
	}

	install(site) {
		site.$grants = this.#grantsLevels(site.constructor);
	}

	headers(res, list) {
		return this.#lock.headers(res, list);
	}

	lock(...list) {
		return (req, res, next) => {
			if (this.locked(req, list)) {
				this.headers(res, list);
				const status = (req.user.grants || []).length == 0 ? 401 : 403;
				res.status(status);
				res.send({ locks: req.locks });
			} else {
				next();
			}
		};
	}

	locked(req, list) {
		const { site, user } = req;
		let { locks } = req;
		if (!locks) locks = req.locks = [];
		if (list != null && !Array.isArray(list) && typeof list == "object" && list.read !== undefined) {
			// backward compat, block.lock only cares about read access
			list = list.read;
		}
		if (list == null) return false;
		else if (typeof list == "string") list = [list];
		else if (list === true) return true;
		else if (list.length == 0) return false;
		let minLevel = Infinity;
		const grants = user.grants || [];
		grants.forEach((grant) => {
			minLevel = Math.min(site.$grants[grant] || Infinity, minLevel);
		});

		let granted = false;
		list.forEach((lock) => {
			const lockIndex = site.$grants[lock] || -1;
			if (lock.startsWith('id-')) {
				if (`id-${user.id}` == lock) granted = true;
				lock = 'id-:id';
			} else if ((lockIndex > minLevel) || grants.includes(lock)) {
				granted = true;
			}
			if (!locks.includes(lock)) locks.push(lock);
		});
		locks.sort((a, b) => {
			const al = site.$grants[a] || -1;
			const bl = site.$grants[b] || -1;
			if (al == bl) return 0;
			else if (al < bl) return 1;
			else if (al > bl) return -1;
		});
		return !granted;
	}

	filterResponse(req, obj, fn) {
		const { item, items } = obj;
		if (!item && !items) {
			return this.filter(req, obj, fn);
		}
		if (item) {
			obj.item = this.filter(req, item, fn);
			if (!obj.item.type) delete obj.items;
		}
		if (obj.items) obj.items = obj.items.map((item) => {
			return this.filter(req, item, fn);
		}).filter((item) => {
			return item && item.type;
		});
		return obj;
	}

	#grantsLevels(DomainBlock) {
		const grants = {};
		try {
			const list = DomainBlock.schema('settings.data.grants').items.anyOf || [];
			list.forEach((grant, i) => {
				const n = grant.$level;
				if (typeof n != 'number' || Number.isNaN(n)) {
					// eslint-disable-next-line no-console
					console.warn("grant without $level, ignoring", grant);
					return;
				}
				grants[grant.const] = n;
			});
		} catch (ex) {
			console.warn("no settings.data.grants found");
		}
		return grants;
	}

	filter(req, item, fn) {
		if (!item.type) return item;
		const { children, child, parents, parent, items } = item;
		if (children) {
			item.children = children.filter((item) => {
				return this.filter(req, item, fn);
			});
		}
		if (items) {
			item.items = items.filter((item) => {
				return this.filter(req, item, fn);
			});
		}
		if (parents) {
			item.parents = parents.filter((item) => {
				return this.filter(req, item, fn);
			});
		}
		if (child) {
			item.child = this.filter(req, child, fn);
			if (item.child && !item.child.type) delete item.type;
		}
		if (parent) {
			item.parent = this.filter(req, parent, fn);
			if (item.parent && !item.parent.type) delete item.type;
		}
		// old types might not have schema
		const schema = req.site.$schema(item.type) || {};
		if (fn && schema) fn(schema, item);

		let $lock = schema.$lock || {};
		if (typeof $lock == "boolean" || typeof $lock == "string" || Array.isArray($lock)) $lock = { '*': $lock };
		const lock = (item.lock || {}).read || [];

		if (Object.keys($lock).length == 0 && lock.length == 0) return item;

		let locks = {
			'*': lock
		};
		locks = Object.assign({}, $lock, locks);
		if (this.locked(req, locks['*'])) {
			if (item.content != null) item.content = {};
			if (item.data != null) item.data = {};
			if (item.expr != null) item.expr = {};
			delete item.type;
			return item;
		}
		delete locks['*'];

		Object.keys(locks).forEach((path) => {
			const list = locks[path];
			path = path.split('.');
			path.reduce((obj, val, index) => {
				if (obj == null) return;
				if (index == path.length - 1) {
					if (this.locked(req, list)) delete obj[val];
				}
				return obj[val];
			}, item);
		});
		return item;
	}
};
