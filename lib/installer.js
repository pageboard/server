const Path = require('node:path');
const { promisify } = require('node:util');
const semverRegex = require.lazy('semver-regex');
const exec = promisify(require('node:child_process').exec);
const postinstall = require.lazy('postinstall');
const { promises: fs } = require('node:fs');

module.exports = class Installer {
	opts = {};

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			dir: Path.join(app.dirs.data, 'sites'),
			...opts
		};
	}

	async install(site) {
		if (!site.data.module) {
			console.info("site has no module");
			return this.#getPkg();
		}
		const pkg = await this.#decide(site);
		if (pkg.install) {
			await this.#install(site, pkg);
		} else {
			console.info("skipped installation of:", site.data.module, site.data.version);
		}
		await this.#populate(site, pkg);
		return pkg;
	}

	async #getPkg(pkgDir = null) {
		const pkgPath = pkgDir != null ? Path.join(pkgDir, 'package.json') : null;
		const pkg = {
			dir: pkgDir,
			path: pkgPath,
			directories: [],
			elements: []
		};
		if (pkgDir == null) return pkg;

		const obj = await readPkg(pkgPath);
		if (!obj) return pkg;
		pkg.server = obj.pageboard && obj.pageboard.server || null;
		const deps = Object.keys(obj.dependencies);
		if (!deps.length) return pkg;
		// if siteModule is a github url, tag will be <siteModule>#hash
		// if siteModule is a real package, tag is a real version
		const name = deps[0];
		let tag = obj.dependencies[name];
		if (tag.indexOf('#') > 0) tag = tag.split('#').pop();
		// version is a string here so this boolean check is all right
		if (!tag || tag.indexOf('/') >= 0) tag = null;
		pkg.name = name;
		pkg.dependencies = obj.dependencies;
		if (tag != null) pkg.tag = tag;
		return pkg;
	}

	async #install(site, pkg) {
		await prepareDir(pkg);
		const module = getSiteModule(site);
		console.info("install", site.id, site.data.module, site.data.version);
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
		if (this.app.env == "development" && process.env.SSH_AUTH_SOCK) {
			// some local setup require to pass this to be able to use ssh keys
			baseEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
		}
		const { bin, timeout } = this.opts;
		let args;
		if (bin == "yarn" || bin == 'yarnpkg') {
			args = [
				'--ignore-scripts',
				'--non-interactive',
				'--ignore-optional',
				'--no-progress',
				'add',
				module
			];
		} else if (bin == 'npm') {
			args = [
				'install',
				'--ignore-scripts',
				'--omit=optional',
				'--omit=dev',
				'--no-progress',
				'--no-audit',
				'--save',
				module
			];
		} else if (bin == "pnpm") {
			args = [
				'install',
				'--ignore-scripts',
				'--no-optional',
				'--prod',
				'--reporter=silent',
				module
			];
		} else {
			throw new Error("Unknown install.bin option, expected pnpm, yarn, npm, got", bin);
		}
		const command = `${bin} ${args.join(' ')}`;
		try {
			await exec(command, {
				cwd: pkg.dir,
				env: baseEnv,
				shell: false,
				timeout
			}).catch(err => {
				if (err.signal == "SIGTERM") err.message = "Timeout installing " + module;
				console.error(command);
				console.error("in", pkg.dir);
				if (err.stderr || err.stdout) {
					throw new Error(err.stderr || err.stdout);
				} else {
					throw err;
				}
			});

			const npkg = await this.#getPkg(pkg.dir);
			if (!npkg.name) throw new Error("Installed module has no package name");
			const result = await runPostinstall(npkg, this.opts);
			if (result) Log.install(result);
			if (npkg.server !== pkg.server) await writePkg(npkg);
			pkg.tag = npkg.tag;
			pkg.name = npkg.name;
			pkg.server = npkg.server;
		} catch (err) {
			await fs.rm(pkg.dir, { recursive: true });
			throw err;
		}
		return pkg;
	}

	// site.data.module (or installed pkg module) may provide a tag

	async #decide(site) {
		const { dir } = this.opts;
		const branch = getSiteBranch(site);
		const { version } = site.data;
		let tag = version;
		if (version == null) {
			// do nothing
			if (/^\w+$/.test(branch) == false) {
				throw new Error(`${site.id} has invalid branch ${branch}`);
			} else {
				tag = branch;
			}
		} else if (/\s+/.test(version) == true || (semverRegex().test(version) == false && /[a-z0-9]+/.test(version) == false)) {
			throw new Error(`${site.id} has invalid version '${version}'`);
		}
		const siteDir = Path.join(dir, site.id, tag);

		const pkg = await this.#getPkg(siteDir);
		const newTag = pkg.tag == null || pkg.tag != tag;
		pkg.tag = tag;
		if (pkg.name == null) {
			pkg.install = true;
			return pkg;
		}
		const siteModuleDir = Path.join(siteDir, 'node_modules', pkg.name);
		try {
			const stat = await fs.lstat(siteModuleDir);
			if (stat.isSymbolicLink()) {
				console.info("detected linked module", pkg.name);
			} else {
				throw new Error();
			}
		} catch (err) {
			if (newTag) {
				pkg.install = true;
			}
		}
		return pkg;
	}

	async #populate(site, pkg) {
		const pair = `${site.id}/${pkg.tag ?? site.data.version}`;
		const siteModuleDir = Path.join(pkg.dir, 'node_modules', pkg.name);
		const sitePkg = await readPkg(Path.join(siteModuleDir, "package.json"), true);
		// configure directories/elements for each dependency
		await Promise.all(Object.keys(sitePkg.dependencies || {}).map(subMod => {
			const moduleDir = Path.join(pkg.dir, 'node_modules', subMod);
			return this.config(moduleDir, pair, subMod, pkg);
		}));
		await this.config(siteModuleDir, pair, pkg.name, pkg);
	}

	async config(moduleDir, id, module, config) {
		Log.install("Module directory", module, moduleDir);
		if (moduleDir == null) {
			throw new Error(`${id} has a missing module ${module}`);
		}
		const meta = await readPkg(Path.join(moduleDir, 'package.json'));
		if (!meta || !meta.pageboard) return;
		let modOpts = meta.pageboard;
		if (modOpts === true) {
			modOpts = {};
		}

		const dstDir = id != 'pageboard' ? Path.join('/', '.files', id, module) : '/.' + id;
		let directories = modOpts.directories || [];
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
					`Warning: ${id} dependency ${module} bad mount from: ${from}`
				);
			} else if (to.startsWith(dstDir) == false) {
				console.warn(
					`Warning: ${id} dependency ${module} bad mount to: ${to}`
				);
			} else {
				config.directories.push({
					from: from,
					to: to,
					priority: modOpts.priority || 0
				});
			}
		});

		let elements = modOpts.elements || [];
		if (!Array.isArray(elements)) elements = [elements];
		Log.install("processing elements from", moduleDir, elements);
		await Promise.all(elements.map(async (path) => {
			const absPath = Path.resolve(moduleDir, path);
			const list = await this.#listDir(absPath);
			list.sort((a, b) => {
				a = Path.basename(a, Path.extname(a));
				b = Path.basename(b, Path.extname(b));
				if (a == b) return 0;
				else if (a > b) return 1;
				else if (a < b) return -1;
			}).map(path => Path.join(absPath, path)).forEach(path => {
				if (path.endsWith('.js')) {
					config.elements.push({
						path,
						priority: modOpts.priority || 0
					});
				}
			});
		}));

		if (id != "pageboard") return;
		else return module;
	}

	async #listDir(dirPath) {
		try {
			const stat = await fs.stat(dirPath);
			if (stat.isDirectory()) {
				return await fs.readdir(dirPath);
			} else {
				return [dirPath];
			}
		} catch {
			return [];
		}
	}

	async clean(site, pkg) {
		const rootSite = Path.join(this.opts.dir, site.id);
		try {
			const paths = await fs.readdir(rootSite);
			const stats = await Promise.all(paths.map(async item => {
				const path = Path.join(rootSite, item);
				const stat = await fs.stat(path);
				return { stat, path };
			}));
			stats.sort((a, b) => {
				if (a.path == pkg.dir) return -1;
				if (a.stat.mtimeMs > b.stat.mtimeMs) return -1;
				if (a.stat.mtimeMs == b.stat.mtimeMs) return 0;
				if (a.stat.mtimeMs < b.stat.mtimeMs) return 1;
			});
			await Promise.all(stats.slice(2).map(obj => {
				return fs.rm(obj.path, { recursive: true });
			}));
		} catch (err) {
			console.error(err);
		}
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
		dependencies: pkg.dependencies || {},
		pageboard: {
			server: pkg.server || null
		}
	}, null, ' '));
	return pkg;
}

async function getDependencies(rootPkg, name, list, deps) {
	if (!deps) deps = {};
	const dir = Path.join(rootPkg.dir, 'node_modules', name);
	if (deps[dir]) return;
	const pkg = await readPkg(Path.join(dir, 'package.json'));
	// nested dep
	if (!pkg || deps[dir]) return;
	deps[dir] = true;

	const pst = (pkg.scripts && pkg.scripts.postinstall || "").split(' ');
	if (pst.includes("postinstall")) {
		list.push({pkg, dir});
	}
	if (pkg.pageboard && pkg.pageboard.server) {
		rootPkg.server = pkg.pageboard.server;
	} else if (pkg.name == "@pageboard/site" && !rootPkg.server) {
		rootPkg.server = pkg.version.split('.').slice(0, 2).join('.');
	}
	return Promise.all(Object.keys(pkg.dependencies || {}).map(name => {
		return getDependencies(rootPkg, name, list, deps);
	}));
}

async function runPostinstall(rootPkg, opts) {
	const list = [];
	await getDependencies(rootPkg, rootPkg.name, list);
	let firstError;
	await Promise.all(list.reverse().map(({ pkg, dir }) => {
		Log.install("postinstall", pkg.name, pkg.version, dir);
		if (!pkg.postinstall) return;
		try {
			return postinstall.process(pkg.postinstall, {
				cwd: dir,
				allow: opts.postinstall || [
					'link',
					'copy',
					'concat',
					'js',
					'css',
					'browserify'
				]
			}).catch(err => {
				if (!firstError) firstError = err;
			});
		} catch (err) {
			if (!firstError) firstError = err;
		}
	}));
	if (firstError) throw firstError;
}

async function readPkg(path, rethrow = false) {
	try {
		const buf = await fs.readFile(path);
		return JSON.parse(buf);
	} catch (err) {
		if (rethrow) throw err;
	}
}

function getSiteBranch(site) {
	const { version, module } = site.data;
	if (version === "") {
		// should not happen
		console.info("site.data.version should not be an empty string", site.id);
		site.data.version = null;
	}
	let branch;
	if (module && module.indexOf('/') > 0 && !module.startsWith('@')) {
		[, branch] = module.split('#');
	}
	if (!branch) branch = 'main';
	return branch;
}

function getSiteModule(site) {
	const { module, version } = site.data;
	let str;
	if (version != null) {
		if (module.indexOf('/') > 0 && !module.startsWith('@')) {
			str = module.split('#').shift();
			str += "#";
		} else {
			str += "@";
		}
		str += version;
	} else {
		str = module;
	}
	return str;
}
