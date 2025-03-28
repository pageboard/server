const Path = require('node:path');
const { promises: fs } = require('node:fs');
const { hash } = require('../../../src/utils');

module.exports = class Package {
	directories = [];
	elements = [];
	dependencies = {};

	dir;

	constructor(dir) {
		this.dir = dir;
	}

	get #lock() {
		return Path.join(this.dir, 'pnpm-lock.yaml');
	}

	get #package() {
		return Path.join(this.dir, 'package.json');
	}

	async move(to) {
		const lock = this.#lock;
		this.dir = to;
		try {
			await fs.mkdir(to);
			await fs.cp(lock, this.#lock);
		} catch {
			// pass
		}
	}

	fromSite(cwd, site) {
		this.name = site.id;
		const { dependencies = {} } = site.data;
		this.linked = false;
		for (const [mod, ver] of Object.entries(dependencies)) {
			if (!ver) {
				delete this.dependencies[mod];
			} else if (ver.startsWith('link://')) {
				this.linked = true;
				this.dependencies[mod] = 'link://' + Path.resolve(cwd, ver.substring('link://'.length));
			} else {
				this.dependencies[mod] = ver;
			}
		}
	}

	async write(serverHash) {
		await fs.mkdir(this.dir, {
			recursive: true
		});
		const obj = {
			private: true,
			name: this.name,
			dependencies: this.dependencies,
			pageboard: {
				hash: serverHash
			},
			pnpm: {
				// only trust our modules
				onlyBuiltDependencies: Object.keys(this.dependencies).filter(
					dep => dep.startsWith('@pageboard/')
				)
			}
		};
		await fs.writeFile(this.#package, JSON.stringify(obj, null, ' '));
	}

	async read() {
		try {
			const buf = await fs.readFile(this.#package);
			const obj = JSON.parse(buf);
			Object.assign(this, obj);
		} catch {
			// pass
		}
		return this;
	}

	static async read(dir) {
		const pkg = new Package(dir);
		return pkg.read();
	}

	async mtime() {
		try {
			const stats = await fs.stat(this.#lock);
			return stats.mtimeMs;
		} catch {
			return 0;
		}
	}

	async touch() {
		await fs.utimes(this.#lock, new Date(), new Date());
	}

	async hash() {
		try {
			return hash(await fs.readFile(this.#lock));
		} catch {
			return "none";
		}
	}

	async getVersions() {
		const versions = {};
		for (const mod of Object.keys(this.dependencies)) {
			const modDir = Path.join(this.dir, 'node_modules', mod);
			const modPkg = await Package.read(modDir);
			versions[mod] = modPkg.version;
		}
		return versions;
	}

};
