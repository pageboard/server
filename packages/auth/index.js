const Upcache = require.lazy('upcache');
const Path = require('node:path');
const { promises: fs } = require('node:fs');
const { promisify } = require('node:util');
const generateKeyPair = promisify(require('node:crypto').generateKeyPair);

module.exports = class AuthModule {
	static name = 'auth';
	static priority = -10;
	static plugins = [Path.join(__dirname, 'services', 'login')];

	#lock;

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			userProperty: 'user',
			keysize: 2048
		};
		if (opts.keysize > this.opts.keysize) {
			this.opts.keysize = opts.keysize;
		}
	}

	async init() {
		const keys = await this.#keygen(
			Path.join(this.app.dirs.data, 'keys.json')
		);
		Object.assign(this.opts, keys);
		this.#lock = Upcache.lock(this.opts);
	}

	async elements() {
		return import('./src/elements.mjs');
	}

	async apiRoutes(app) {
		app.use((req, res, next) => {
			req.locks = [];
			req.finish(() => {
				// TODO with the app.get/post refactoring,
				// this must simply be done in api.send
				if (req.locks?.length) {
					this.sort(req);
					this.#lock.headers(res, req.locks);
				}
			});
			this.#lock.init(req, res, next);
		});
	}

	bearer(req, { maxAge, id, grants }) {
		return {
			value: this.#lock.sign({ id,	grants }, {
				issuer: req.site.$url.hostname,
				maxAge,
				...this.opts
			}),
			maxAge: maxAge * 1000
		};
	}
	static bearer = {
		title: 'Authorization Bearer',
		$private: true,
		required: ['id', 'grants'],
		properties: {
			maxAge: {
				title: 'Max Age',
				description: 'max age of cookie in seconds',
				type: 'integer',
				default: 60 * 60 * 24
			},
			id: {
				title: 'User ID',
				type: 'string',
				format: 'id'
			},
			grants: {
				title: 'Grants',
				type: 'array',
				items: {
					type: 'string',
					format: 'grant'
				}
			}
		}
	};

	async #keygen(keysPath) {
		let keys;
		try {
			const buf = await fs.readFile(keysPath);
			keys = JSON.parse(buf.toString());
		} catch {
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
		site.$pkg.grants = this.#grantsLevels(site);
	}

	sort({ site , locks }) {
		const { grants } = site.$pkg;
		locks.sort((a, b) => {
			const al = grants[a] || -1;
			const bl = grants[b] || -1;
			if (al == bl) return 0;
			else if (al < bl) return 1;
			else if (al > bl) return -1;
		});
		return locks;
	}

	lock(...list) {
		return (req, res, next) => {
			if (this.locked(req, list)) {
				const status = req.user.grants.length == 0 ? 401 : 403;
				res.status(status);
				res.send({ locks: req.locks });
			} else {
				next();
			}
		};
	}

	locked(req, list, cannotEscalate = false) {
		const { site, user } = req;
		const { locks } = req;
		if (list == null) return false;
		else if (typeof list == "string") list = [list];
		else if (list === true) return true;
		else if (list.length == 0) return false;

		let minLevel = Infinity;
		const { grants } = user;
		const grantsMap = site.$pkg.grants;
		for (const grant of grants) {
			minLevel = Math.min(grantsMap[grant] || Infinity, minLevel);
		}

		let granted = false;
		list.forEach(lock => {
			const lockIndex = grantsMap[lock] || -1;
			if (lock.startsWith('id-')) {
				// FIXME reconsider this
				// the id-:id permission should be a special permission called "self"
				// (and that keyword is used in schemas, but allow old id-:id for a while
				// rename $lock to locks (support that in the packager to allow smooth transition)
				// note that this isn't a change that must be made here,
				// it must be made when saving a block to DB schema.locks self -> block.locks = [id-${user.id}]s
				// locks: ['self', 'users'] for accounts managers
				// locks: ['self'] for really private data
				// a user MUST HAVE the grant that matches the permission in locks
				// no fancy stuff about higher permissions
				// just give the user the permissions to allow. A webmaster might not be able to read "users"
				// however a webmaster can have the "grants" permission which allows to grant oneself lesser permissions
				if (`id-${user.id}` == lock) granted = true;
				lock = 'id-:id';
			} else if ((lockIndex > minLevel) || !cannotEscalate && grants.includes(lock)) {
				granted = true;
			}
			if (!locks.includes(lock)) locks.push(lock);
		});
		return !granted;
	}


	#grantsLevels(site) {
		const grants = {};
		try {
			const list = site.$schema('settings.data.grants').items.anyOf || [];
			list.forEach((grant, i) => {
				const n = grant.$level;
				if (typeof n != 'number' || Number.isNaN(n)) {
					// eslint-disable-next-line no-console
					console.warn("grant without $level, ignoring", grant);
					return;
				}
				grants[grant.const] = n;
			});
		} catch {
			console.warn("no settings.data.grants found");
		}
		return grants;
	}

	$filter(req, schema, item) {
		let $lock = schema.$lock || {};
		if (typeof $lock == "boolean" || typeof $lock == "string" || Array.isArray($lock)) $lock = { '*': $lock };
		const lock = item.lock || [];

		if (Object.keys($lock).length == 0 && lock.length == 0) return item;

		let locks = {
			'*': lock
		};
		locks = { ...$lock, ...locks };
		if (this.locked(req, locks['*'])) {
			if (item.content != null) item.content = {};
			if (item.data != null) item.data = {};
			if (item.expr != null) item.expr = {};
			delete item.type;
			return item;
		}
		delete locks['*'];
		for (const [path, list] of Object.entries(locks)) {
			path.split('.').reduce((obj, val, index, arr) => {
				if (obj == null) return;
				if (index == arr.length - 1) {
					if (this.locked(req, list)) delete obj[val];
				}
				return obj[val];
			}, item);
		}
		return item;
	}
};
