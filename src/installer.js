const Path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').exec);
const postinstall = require.lazy('postinstall');
const { promises: fs } = require('node:fs');
const assert = require('node:assert/strict');
const utils = require.lazy('./utils');
const semver = require('semver');

module.exports = class Installer {
	opts = {};

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async install(site) {
		const siteDir = this.app.statics.dir({ site }, '@site');
		const nextDir = Path.join(siteDir, 'next');
		await fs.rm(nextDir, { recursive: true, force: true });
		const curPkg = await this.#getPkg(Path.join(siteDir, 'current'));
		curPkg.current = true;
		let nextPkg = await this.#getPkg(nextDir);
		nextPkg.dependencies = site.data.dependencies ?? {};
		if (this.#decide(curPkg, nextPkg)) {
			await this.#install(site, nextPkg);
			const versionDir = Path.join(siteDir, nextPkg.version);
			await fs.mv(nextPkg.dir, versionDir);
			await fs.symlink("next", versionDir);
			nextPkg.dir = versionDir;
		} else {
			nextPkg = curPkg;
			const versionDir = Path.join(siteDir, nextPkg.version);
			nextPkg.dir = versionDir;
		}
		await Promise.all(Object.keys(nextPkg.dependencies).map(
			mod => this.#config(site, nextPkg, mod)
		));
		return nextPkg;
	}

	#decide(curPkg, nextPkg) {
		try {
			assert.deepEqual(
				Object.keys(curPkg.dependencies),
				Object.keys(nextPkg.dependencies)
			);
			for (const [mod, spec] of Object.entries(nextPkg.dependencies)) {
				if (!semver.satisfies(curPkg.versions[mod], spec)) throw new Error();
			}
			return false;
		} catch {
			// needs install
			return true;
		}
	}

	async #getPkg(pkgDir) {
		const pkgPath = Path.join(pkgDir, 'package.json');
		const obj = await readPkg(pkgPath) ?? {};
		obj.dir = pkgDir;
		obj.path = pkgPath;
		obj.directories ??= [];
		obj.elements ??= [];
		obj.dependencies ??= {};
		obj.versions ??= {};
		return obj;
	}

	async #install(site, pkg) {
		pkg.name = site.id;
		await prepareDir(pkg);
		console.info("install", pkg.name, pkg.dependencies);
		const baseEnv = {
			npm_config_userconfig: ''
		};
		Object.entries(process.env).forEach(([key, val]) => {
			if (
				['HOME', 'PATH', 'LANG', 'SHELL'].includes(key) ||
				key.startsWith('XDG_') || key.startsWith('LC_')
			) {
				baseEnv[key] = val;
			}
		});
		if (process.env.SSH_AUTH_SOCK) {
			// some local setup require to pass this to be able to use ssh keys
			// for git checkouts on private repositories
			baseEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
		}
		const { bin, timeout } = this.opts;
		let args;
		if (bin == "yarn" || bin == 'yarnpkg') {
			args = [
				'install',
				'--ignore-scripts',
				'--non-interactive',
				'--ignore-optional',
				'--no-progress'
			];
		} else if (bin == 'npm') {
			args = [
				'install',
				'--ignore-scripts',
				'--omit=optional',
				'--omit=dev',
				'--no-progress',
				'--no-audit'
			];
		} else if (bin == "pnpm") {
			args = [
				'install',
				'--ignore-scripts',
				'--no-optional',
				'--prod',
				// '--reporter=silent', // https://github.com/pnpm/pnpm/issues/2738
				'--reporter=append-only'
			];
		} else {
			throw new Error("Unknown installer.bin option, expected pnpm, yarn, npm", bin);
		}
		const command = `${bin} ${args.join(' ')}`;

		await exec(command, {
			cwd: pkg.dir,
			env: baseEnv,
			shell: false,
			timeout
		}).catch(err => {
			// FIXME after failure, won't process new requests / see domain too
			if (err.signal == "SIGTERM") err.message = "Timeout installing " + site.id;
			console.error(command);
			console.error("in", pkg.dir);
			if (err.stderr || err.stdout) {
				throw new Error(err.stderr || err.stdout);
			} else {
				throw err;
			}
		});
		for (const mod of Object.keys(pkg.dependencies)) {
			const modDir = Path.join(pkg.dir, 'node_modules', mod);
			const modPkg = await readPkg(Path.join(modDir, 'package.json'));
			pkg.versions[mod] = modPkg.version;
			if (!modPkg.postinstall) continue;
			const result = await postinstall.process(modPkg.postinstall, {
				cwd: modDir,
				allow: [
					'link'
				]
			});
			if (result) Log.install(result);
		}
		pkg.version = utils.hash(JSON.stringify(pkg.versions));
		await writePkg(pkg);
		return pkg;
	}

	async #config(site, pkg, mod) {
		const { id } = site;
		const moduleDir = Path.join(pkg.dir, 'node_modules', mod);
		const meta = await this.#getPkg(moduleDir);
		const pbConf = meta.pageboard;
		if (!pbConf) {
			throw new HttpError.BadRequest(`site dependency ${mod} must declare at least package.json#pageboard.version`);
		}
		if (!semver.satisfies(this.app.version, pbConf.version)) {
			throw new HttpError.BadRequest(`Server ${this.app.version} is not compatible with module ${mod} which has support for server ${pbConf.version}`);
		}
		pkg.versions[meta.name] = meta.version;
		const dstDir = Path.join('/', '@site', mod, meta.version);
		let directories = pbConf.directories || [];
		if (!Array.isArray(directories)) directories = [directories];
		Log.install("processing directories from", moduleDir, directories);
		directories.forEach(mount => {
			if (typeof mount == "string") mount = {
				from: mount,
				to: mount
			};
			const from = Path.resolve(moduleDir, mount.from);
			const to = Path.resolve(dstDir, mount.to);
			if (from.startsWith(moduleDir) == false) {
				console.warn(
					`Warning: ${id} dependency ${mod} bad mount from: ${from}`
				);
			} else if (to.startsWith(dstDir) == false) {
				console.warn(
					`Warning: ${id} dependency ${mod} bad mount to: ${to}`
				);
			} else {
				pkg.directories.push({
					from: from,
					to: to,
					priority: pbConf.priority || 0
				});
			}
		});

		let elements = pbConf.elements || [];
		if (!Array.isArray(elements)) elements = [elements];
		Log.install("processing elements from", moduleDir, elements);
		await Promise.all(elements.map(async (path) => {
			const absPath = Path.resolve(moduleDir, path);
			const list = await this.#listDir(id, absPath);
			list.sort((a, b) => {
				a = Path.basename(a, Path.extname(a));
				b = Path.basename(b, Path.extname(b));
				if (a == b) return 0;
				else if (a > b) return 1;
				else if (a < b) return -1;
			}).map(path => Path.join(absPath, path)).forEach(path => {
				if (path.endsWith('.js')) {
					pkg.elements.push({
						path,
						priority: pbConf.priority || 0
					});
				}
			});
		}));
	}

	async #listDir(id, dirPath) {
		try {
			const stat = await fs.stat(dirPath);
			if (stat.isDirectory()) {
				return await fs.readdir(dirPath);
			} else {
				return [dirPath];
			}
		} catch (err) {
			console.warn("In site", id, err);
			return [];
		}
	}

	async clean(site, pkg) {
		if (pkg.current || !await utils.exists(pkg.dir)) return; // fail safe
		const rootSite = this.app.statics.dir({ site }, '@site');
		const curDir = Path.join(rootSite, 'current');
		await fs.rm(curDir, { recursive: true, force: true });
		await fs.symlink(pkg.dir, 'current');
		return pkg;
	}
};

async function prepareDir(pkg) {
	await fs.mkdir(pkg.dir, {
		recursive: true
	});
	return writePkg(pkg);
}

async function writePkg(pkg) {
	await fs.writeFile(pkg.path, JSON.stringify({
		"private": true,
		name: pkg.name,
		dependencies: pkg.dependencies,
		versions: pkg.versions,
		version: pkg.version
	}, null, ' '));
	return pkg;
}

async function readPkg(path) {
	try {
		const buf = await fs.readFile(path);
		return JSON.parse(buf);
	} catch {
		return {};
	}
}

