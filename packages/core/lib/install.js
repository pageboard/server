const Path = require('path');
const pify = require('util').promisify;
const semverRegex = require('semver-regex');
const rimraf = pify(require('rimraf'));
const exec = pify(require('child_process').exec);
const postinstall = require('postinstall');

const fs = require('fs').promises;

exports.install = function(site, opt) {
	if (!site.data.module) {
		console.info("site has no module");
		return getPkg();
	}
	const dataDir = Path.join(opt.dirs.data, 'sites');

	return decideInstall(dataDir, site).then((pkg) => {
		if (pkg.install) {
			return doInstall(site, pkg, opt);
		} else {
			console.info("skipped installation of:", site.data.module, site.data.version);
			return pkg;
		}
	}).then((pkg) => {
		return populatePkg(site, pkg);
	});
};

exports.config = function(moduleDir, id, module, config) {
	Log.install("Module directory", module, moduleDir);
	if (moduleDir == null) throw new Error(`${id} has a missing module ${module}`);
	return fs.readFile(Path.join(moduleDir, 'package.json')).then((buf) => {
		const meta = JSON.parse(buf);
		let modOpts = meta.pageboard;
		if (!modOpts) {
			return true; // nothing to do
		} else if (modOpts === true) {
			modOpts = {};
		}
		if (meta.name && meta.version != null) {
			// this is used for app-level cache tag
			if (!config.versions) config.versions = {};
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
			if (from.startsWith(moduleDir) == false) {
				console.warn(`Warning: ${id} dependency ${module} bad mount from: ${from}`);
				return;
			}
			const to = Path.resolve(dstDir, mount.to);
			if (to.startsWith(dstDir) == false) {
				console.warn(`Warning: ${id} dependency ${module} bad mount to: ${to}`);
				return;
			}
			config.directories.push({
				from: from,
				to: to,
				priority: modOpts.priority || 0
			});
		});

		let elements = modOpts.elements || [];
		if (!Array.isArray(elements)) elements = [elements];
		Log.install("processing elements from", moduleDir, elements);
		return Promise.all(elements.map((path) => {
			const absPath = Path.resolve(moduleDir, path);
			return fs.stat(absPath).then((stat) => {
				if (stat.isDirectory()) return fs.readdir(absPath).then((paths) => {
					// make sure files are ordered by basename
					paths.sort((a, b) => {
						a = Path.basename(a, Path.extname(a));
						b = Path.basename(b, Path.extname(b));
						if (a == b) return 0;
						else if (a > b) return 1;
						else if (a < b) return -1;
					});
					return paths.map((path) => {
						return Path.join(absPath, path);
					});
				});
				else return [absPath];
			}).then((paths) => {
				paths.forEach((path) => {
					if (path.endsWith('.js')) {
						config.elements.push({
							path: path,
							priority: modOpts.priority || 0
						});
					}
				});
			});
		}));
	}).catch((err) => {
		console.error(`Error: ${id} dependency ${module} cannot be extracted`, err);
		return true;
	}).then((not) => {
		if (id != "pageboard" || not === true) return;
		return module;
	});
};

exports.clean = function (site, pkg, opt) {
	const rootSite = Path.join(opt.dirs.data, 'sites', site.id);
	return fs.readdir(rootSite).then((paths) => {
		return Promise.all(paths.map((path) => {
			path = Path.join(rootSite, path);
			return fs.stat(path).then((stat) => {
				return {stat, path};
			});
		})).then((stats) => {
			stats.sort((a, b) => {
				if (a.path == pkg.dir) return -1;
				if (a.stat.mtimeMs > b.stat.mtimeMs) return -1;
				if (a.stat.mtimeMs == b.stat.mtimeMs) return 0;
				if (a.stat.mtimeMs < b.stat.mtimeMs) return 1;
			});
			return Promise.all(stats.slice(2).map(obj => {
				return rimraf(obj.path, { glob: false });
			}));
		});
	}).catch((err) => {
		console.error(err);
	}).then(() => {
		return pkg;
	});
};

function decideInstall(dataDir, site) {
	let version = site.data.version;
	if (version == "") version = site.data.version = null; // temporary fix, should not happen
	if (version == null) {
		const module = site.data.module;
		let branch;
		if (module.indexOf('/') > 0 && !module.startsWith('@')) {
			branch = module.split('#').pop();
		}
		site.branch = version = branch || "master";
	} else if (/\s/.test(version) == true || semverRegex().test(version) == false && /^\w+$/.test(version) == false) {
		return Promise.reject(new Error(`${site.id} has invalid version ${version}`));
	}
	const siteDir = Path.join(dataDir, site.id, version);

	return getPkg(siteDir).then((pkg) => {
		if (pkg.name == null) {
			pkg.install = true;
			return pkg;
		}
		const siteModuleDir = Path.join(siteDir, 'node_modules', pkg.name);
		return fs.lstat(siteModuleDir).catch(() => {}).then((stat) => {
			if (stat && stat.isSymbolicLink()) {
				console.warn("detected linked module", pkg.name);
			} else if (pkg.version == null || pkg.version != site.data.version) {
				pkg.install = true;
			}
			return pkg;
		});
	});
}

function doInstall(site, pkg, opt) {
	return prepareDir(pkg).then(() => {
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
		if (opt.env == "development" && process.env.SSH_AUTH_SOCK) {
			// some local setup require to pass this to be able to use ssh keys
			baseEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
		}
		let args;
		if (opt.installer.bin == "yarn" || opt.installer.bin == 'yarnpkg') {
			args = [
				'--ignore-scripts',
				'--non-interactive',
				'--ignore-optional',
				'--no-progress',
				'add',
				module
			];
		} else if (opt.installer.bin == 'npm') {
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
			throw new Error("Unknown install.bin option, expected yarn or npm, got", opt.installer.bin);
		}
		const command = `${opt.installer.path} ${args.join(' ')}`;
		return exec(command, {
			cwd: pkg.dir,
			env: baseEnv,
			shell: false,
			timeout: opt.installer.timeout
		}).catch((err) => {
			console.error(command);
			console.error("in", pkg.dir);
			throw new Error(err.stderr.toString() || err.stdout.toString());
		});
	}).then(() => {
		return getPkg(pkg.dir).then((npkg) => {
			if (!npkg.name) throw new Error("Installed module has no package name");
			return npkg;
		}).then((pkg) => {
			return runPostinstall(pkg, opt).then((result) => {
				if (result) Log.install(result);
				if (pkg.server) return writePkg(pkg);
				else return pkg;
			});
		});
	}).catch((err) => {
		return rimraf(pkg.dir, {glob: false}).then(() => {
			throw err;
		});
	});
}

function prepareDir(pkg) {
	return fs.mkdir(pkg.dir, {
		recursive: true
	}).then(() => {
		return writePkg(pkg);
	});
}

function writePkg(pkg) {
	return fs.writeFile(pkg.path, JSON.stringify({
		"private": true,
		dependencies: pkg.dependencies || {},
		pageboard: {
			server: pkg.server || null
		}
	}, null, ' ')).then(() => {
		return pkg;
	});
}

function populatePkg(site, pkg) {
	const version = pkg.version || site.branch || site.data.version;
	const pair = `${site.id}/${version}`;
	const siteModuleDir = Path.join(pkg.dir, 'node_modules', pkg.name);
	return fs.readFile(Path.join(siteModuleDir, "package.json")).then((buf) => {
		return JSON.parse(buf.toString());
	}).then((sitePkg) => {
		// configure directories/elements for each dependency
		return Promise.all(Object.keys(sitePkg.dependencies || {}).map((subModule) => {
			const moduleDir = Path.join(pkg.dir, 'node_modules', subModule);
			return exports.config(moduleDir, pair, subModule, pkg);
		})).then(() => {
			// configure directories/elements for the module itself (so it can
			// overrides what the dependencies have installed
			return exports.config(siteModuleDir, pair, pkg.name, pkg);
		});
	}).then(() => {
		return pkg;
	});
}

function getPkg(pkgDir) {
	const pkgPath = pkgDir != null ? Path.join(pkgDir, 'package.json') : null;
	const pkg = {
		dir: pkgDir,
		path: pkgPath,
		directories: [],
		elements: []
	};
	if (pkgDir == null) return Promise.resolve(pkg);
	return fs.readFile(pkgPath).then((buf) => {
		const obj = JSON.parse(buf.toString());
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
	}).catch((err) => {
		return pkg;
	});
}

function getDependencies(rootPkg, name, list, deps) {
	if (!deps) deps = {};
	const dir = Path.join(rootPkg.dir, 'node_modules', name);
	if (deps[dir]) return;
	return fs.readFile(Path.join(dir, 'package.json')).catch((err) => {
		// nested dep
	}).then((buf) => {
		if (!buf || deps[dir]) return;
		deps[dir] = true;
		const pkg = JSON.parse(buf);
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
	});
}

function runPostinstall(rootPkg, opt) {
	const list = [];
	return getDependencies(rootPkg, rootPkg.name, list).then(() => {
		let firstError;
		return Promise.all(list.reverse().map(({pkg, dir}) => {
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
			} catch(err) {
				if (!firstError) firstError = err;
			}
		})).then(() => {
			if (firstError) throw firstError;
		});
	});
}
