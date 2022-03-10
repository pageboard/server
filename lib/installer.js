const Path = require('path');
const { promisify } = require('util');
const semverRegex = require.lazy('semver-regex');
const exec = promisify(require('child_process').exec);
const postinstall = require.lazy('postinstall');
const { promises: fs } = require('fs');

module.exports = class Installer {
	opts = {};

	constructor(app) {
		this.app = app;
		this.opts.dir = Path.join(this.app.dirs.data, 'sites');
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
		// if siteModule is a github url, version will be <siteModule>#hash
		// if siteModule is a real package, version is a real version
		const name = deps[0];
		let version = obj.dependencies[name];
		if (version.indexOf('#') > 0) version = version.split('#').pop();
		// version is a string here so this boolean check is all right
		if (!version || version.indexOf('/') >= 0) version = null;
		pkg.name = name;
		pkg.dependencies = obj.dependencies;
		if (version != null) pkg.version = version;
		return pkg;
	}

	async #install(site, pkg) {
		await prepareDir(pkg);
		const version = site.data.version;
		let module = site.data.module;
		if (version != null) {
			if (module.indexOf('/') > 0 && !module.startsWith('@')) {
				module = module.split('#').shift();
				module += "#";
			} else {
				module += "@";
			}
			module += version;
		}
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
		const opts = this.opts.installer;
		let args;
		if (opts.bin == "yarn" || opts.bin == 'yarnpkg') {
			args = [
				'--ignore-scripts',
				'--non-interactive',
				'--ignore-optional',
				'--no-progress',
				'add',
				module
			];
		} else if (opts.bin == 'npm') {
			args = [
				'install',
				'--ignore-scripts',
				'--no-optional',
				'--no-progress',
				'--production',
				'--no-audit',
				'--save',
				module
			];
		} else {
			throw new Error("Unknown install.bin option, expected yarn or npm, got", opts.bin);
		}
		const command = `${opts.path} ${args.join(' ')}`;
		try {
			await exec(command, {
				cwd: pkg.dir,
				env: baseEnv,
				shell: false,
				timeout: opts.timeout
			}).catch((err) => {
				console.error(command);
				console.error("in", pkg.dir);
				throw new Error(err.stderr.toString() || err.stdout.toString());
			});

			const npkg = await this.#getPkg(pkg.dir);
			if (!npkg.name) throw new Error("Installed module has no package name");
			const result = await runPostinstall(pkg, this.opts);
			if (result) Log.install(result);
			if (pkg.server) await writePkg(pkg);
		} catch (err) {
			await fs.rmdir(pkg.dir, { recursive: true });
			throw err;
		}
		return pkg;
	}

	async #decide(site) {
		const dir = this.opts.dir;
		let version = site.data.version;
		if (version == "") version = site.data.version = null; // temporary fix, should not happen
		if (version == null) {
			const module = site.data.module;
			let branch;
			if (module.indexOf('/') > 0 && !module.startsWith('@')) {
				[, branch] = module.split('#');
			}
			site.branch = version = branch || "master";
		} else if (/\s/.test(version) == true || semverRegex().test(version) == false && /^\w+$/.test(version) == false) {
			return Promise.reject(new Error(`${site.id} has invalid version ${version}`));
		}
		const siteDir = Path.join(dir, site.id, version);

		const pkg = await this.#getPkg(siteDir);
		if (pkg.name == null) {
			pkg.install = true;
			return pkg;
		}
		const siteModuleDir = Path.join(siteDir, 'node_modules', pkg.name);
		try {
			const stat = await fs.lstat(siteModuleDir);
			if (stat.isSymbolicLink()) {
				console.warn("detected linked module", pkg.name);
			} else {
				throw new Error();
			}
		} catch (err) {
			if (pkg.version == null || pkg.version != site.data.version) {
				pkg.install = true;
			}
		}
		return pkg;
	}

	async #populate(site, pkg) {
		const version = pkg.version || site.branch || site.data.version;
		const pair = `${site.id}/${version}`;
		const siteModuleDir = Path.join(pkg.dir, 'node_modules', pkg.name);
		const sitePkg = await readPkg(Path.join(siteModuleDir, "package.json"), true);
		// configure directories/elements for each dependency
		await Promise.all(Object.keys(sitePkg.dependencies || {}).map((subModule) => {
			const moduleDir = Path.join(pkg.dir, 'node_modules', subModule);
			return this.config(moduleDir, pair, subModule, pkg);
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
		if (config.versions && meta.name && meta.version != null) {
			// this is used for app-level cache tag
			config.versions[meta.name] = meta.version || "*";
		}

		const dstDir = id != 'pageboard' ? Path.join('/', '.files', id, module) : '/.' + id;
		let directories = modOpts.directories || [];
		if (!Array.isArray(directories)) directories = [directories];
		Log.install("processing directories from", moduleDir, directories);
		directories.forEach((mount) => {
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
			const stat = await fs.stat(absPath);
			(
				stat.isDirectory() ? await fs.readdir(absPath) : [absPath]
			).sort((a, b) => {
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

	async clean(site, pkg) {
		const rootSite = Path.join(this.opts.dir, site.id);
		try {
			const paths = await fs.readdir(rootSite);
			const stats = Promise.all(paths.map(async item => {
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
				return fs.rmdir(obj.path, { recursive: true });
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
	return Promise.all(Object.keys(pkg.dependencies || {}).map((name) => {
		return getDependencies(rootPkg, name, list, deps);
	}));
}

async function runPostinstall(rootPkg, opt) {
	const list = [];
	await getDependencies(rootPkg, rootPkg.name, list);
	let firstError;
	await Promise.all(list.reverse().map(({ pkg, dir }) => {
		Log.install("postinstall", pkg.name, pkg.version, dir);
		if (!pkg.postinstall) return;
		try {
			return postinstall.process(pkg.postinstall, {
				cwd: dir,
				allow: opt.postinstall || [
					'link',
					'copy',
					'concat',
					'js',
					'css',
					'browserify'
				]
			}).catch((err) => {
				if (!firstError) firstError = err;
			});
		} catch (err) {
			if (!firstError) firstError = err;
		}
	}));
	if (firstError) throw firstError;
}

async function readPkg(path, rethrow = true) {
	try {
		const buf = await fs.readFile(path);
		return JSON.parse(buf);
	} catch (err) {
		if (rethrow) throw err;
	}
}
