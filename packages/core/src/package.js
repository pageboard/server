const Path = require('node:path');
const { promises: fs } = require('node:fs');
const { hash } = require('../../../src/utils');

module.exports = class Package {
	directories = [];
	elements = [];
	dependencies = {};

	#path;

	constructor(dir) {
		this.dir = dir;
		this.#path = Path.join(dir, 'package.json');
	}

	fromSite(cwd, site) {
		this.name = site.id;
		const { dependencies } = site.data;
		for (const [mod, ver] of Object.entries(dependencies)) {
			this.dependencies[mod] = ver.startsWith('link://')
				? 'link://' + Path.resolve(cwd, ver.substring('link://'.length))
				: ver;
		}
	}

	async write() {
		await fs.mkdir(this.dir, {
			recursive: true
		});
		await fs.writeFile(this.#path, JSON.stringify({
			private: true,
			name: this.name,
			dependencies: this.dependencies
		}, null, ' '));
	}

	async read() {
		try {
			const buf = await fs.readFile(this.#path);
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

	async hash() {
		try {
			return hash(await fs.readFile(Path.join(this.dir, 'pnpm-lock.yaml')));
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
