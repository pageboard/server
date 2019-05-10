var Path = require('path');
var pify = require('util').promisify;
var mkdirp = pify(require('mkdirp'));
var semverRegex = require('semver-regex');
var rimraf = pify(require('rimraf'));
var debug = require('debug')('pageboard:core');
var spawn = require('child_process').spawn;
var postinstall = require('postinstall');

var fs = {
	writeFile: pify(require('fs').writeFile),
	readFile: pify(require('fs').readFile),
	readdir: pify(require('fs').readdir),
	stat: pify(require('fs').stat),
	lstat: pify(require('fs').lstat),
	unlink: pify(require('fs').unlink),
	symlink: pify(require('fs').symlink)
};

exports.install = function(site, opt) {
	if (!site.data.module) {
		console.info("site has no module");
		return getPkg();
	}
	var dataDir = Path.join(opt.dirs.data, 'sites');

	return decideInstall(dataDir, site).then(function(pkg) {
		if (pkg.install) {
			return doInstall(site, pkg, opt);
		} else {
			console.info("skipped installation of:", site.data.module, site.data.version);
			return pkg;
		}
	}).then(function(pkg) {
		return populatePkg(site, pkg);
	});
};

exports.config = function(moduleDir, id, module, config) {
	debug("Module directory", module, moduleDir);
	return fs.readFile(Path.join(moduleDir, 'package.json')).then(function(buf) {
		var meta = JSON.parse(buf);
		var modOpts = meta.pageboard;
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

		var dstDir = id != 'pageboard' ? Path.join('/', '.files', id, module) : '/.' + id;
		var directories = modOpts.directories || [];
		if (!Array.isArray(directories)) directories = [directories];
		debug("processing directories from", moduleDir, directories);
		directories.forEach(function(mount) {
			if (typeof mount == "string") mount = {
				from: mount,
				to: mount
			};
			var from = Path.resolve(moduleDir, mount.from);
			if (from.startsWith(moduleDir) == false) {
				console.warn(`Warning: ${id} dependency ${module} bad mount from: ${from}`);
				return;
			}
			var to = Path.resolve(dstDir, mount.to);
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

		var elements = modOpts.elements || [];
		if (!Array.isArray(elements)) elements = [elements];
		debug("processing elements from", moduleDir, elements);
		return Promise.all(elements.map(function(path) {
			var absPath = Path.resolve(moduleDir, path);
			return fs.stat(absPath).then(function(stat) {
				if (stat.isDirectory()) return fs.readdir(absPath).then(function(paths) {
					// make sure files are ordered by basename
					paths.sort(function(a, b) {
						a = Path.basename(a, Path.extname(a));
						b = Path.basename(b, Path.extname(b));
						if (a == b) return 0;
						else if (a > b) return 1;
						else if (a < b) return -1;
					});
					return paths.map(function(path) {
						return Path.join(absPath, path);
					});
				});
				else return [absPath];
			}).then(function(paths) {
				paths.forEach(function(path) {
					if (path.endsWith('.js')) {
						config.elements.push({
							path: path,
							priority: modOpts.priority || 0
						});
					}
				});
			});
		}));
	}).catch(function(err) {
		console.error(`Error: ${id} dependency ${module} cannot be extracted`, err);
		return true;
	}).then(function(not) {
		if (id != "pageboard" || not === true) return;
		return module;
	});
};

exports.clean = function(site, pkg, opt) {
	var rootSite = Path.join(opt.dirs.data, 'sites', site.id);
	return fs.readdir(rootSite).then(function(paths) {
		return Promise.all(paths.map(function(path) {
			path = Path.join(rootSite, path);
			return fs.stat(path).then(function(stat) {
				return {stat, path};
			});
		})).then(function(stats) {
			stats.sort(function(a, b) {
				if (a.path == pkg.dir) return -1;
				if (a.stat.mtimeMs > b.stat.mtimeMs) return -1;
				if (a.stat.mtimeMs == b.stat.mtimeMs) return 0;
				if (a.stat.mtimeMs < b.stat.mtimeMs) return 1;
			});
			return Promise.all(stats.slice(2).map(function(obj) {
				return rimraf(obj.path);
			}));
		});
	}).catch(function(err) {
		console.error(err);
	}).then(function() {
		return pkg;
	});
};

function decideInstall(dataDir, site) {
	var version = site.data.version;
	if (version == "") version = site.data.version = null; // temporary fix, should not happen
	if (version == null) {
		var module = site.data.module;
		var branch;
		if (module.indexOf('/') > 0 && !module.startsWith('@')) {
			branch = module.split('#').pop();
		}
		site.branch = version = branch || "master";
	} else if (/\s/.test(version) == true || semverRegex().test(version) == false && /^\w+$/.test(version) == false) {
		return Promise.reject(new Error(`${site.id} has invalid version ${version}`));
	}
	var siteDir = Path.join(dataDir, site.id, version);

	return getPkg(siteDir).then(function(pkg) {
		if (pkg.name == null) {
			pkg.install = true;
			return pkg;
		}
		if (site.data.version == null) {
			// something is installed
			// if you want to update call site.save data.version...
			return pkg;
		}
		var siteModuleDir = Path.join(siteDir, 'node_modules', pkg.name);
		return fs.lstat(siteModuleDir).catch(function() {}).then(function(stat) {
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
	return prepareDir(pkg).then(function() {
		var version = site.data.version;
		var module = site.data.module;
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
		var baseEnv = {
			HOME: process.env.HOME,
			PATH: process.env.PATH
		};
		if (opt.env == "development" && process.env.SSH_AUTH_SOCK) {
			// some local setup require to pass this to be able to use ssh keys
			baseEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
		}
		var args;
		if (opt.installer.bin == "yarn") {
			args = [
				'--ignore-scripts',
				'--non-interactive',
				'--ignore-optional',
				'--no-progress',
				'--production',
				'--no-lockfile',
				'--silent',
				'add',
				module
			];
		} else {
			args = [
				'install',
				'--ignore-scripts',
				'--no-optional',
				'--no-progress',
				'--production',
				'--no-package-lock',
				'--silent',
				'--no-audit',
				'--save',
				module
			];
		}
		return new Promise(function(resolve, reject) {
			var proc = spawn(opt.installer.path, args, {
				cwd: pkg.dir,
				env: Object.assign(baseEnv, {
					npm_config_userconfig: '' // attempt to disable user config
				}),
				stdio: ['ignore', 'inherit', 'inherit']
			});
			proc.on('exit', function(code, signal) {
				if (code !== 0) reject(`${opt.installer.path} exits with code ${code} ${signal}`);
				else resolve(`${opt.installer.bin} installed ${module}`);
			});

			setTimeout(function() {
				proc.kill('SIGKILL');
			}, opt.installer.timeout);
		});
	}).catch(function(err) {
		if (typeof err == "string") {
			var installError = new Error(err);
			installError.name = "InstallationError";
			err = installError;
			delete err.stack;
		}
		throw err;
	}).then(function(out) {
		return getPkg(pkg.dir).then(function(npkg) {
			if (!npkg.name) {
				var err = new Error("Installation error");
				err.output = out;
				throw err;
			}
			return npkg;
		}).then(function(pkg) {
			return runPostinstall(pkg.dir, pkg.name, opt).then(function(result) {
				if (result) debug(result);
				return pkg;
			});
		});
	});
}

function prepareDir(pkg) {
	return mkdirp(pkg.dir).then(function() {
		return fs.writeFile(pkg.path, JSON.stringify({
			"private": true,
			"dependencies": {} // installation of main module populates it for us
		}));
	});
}

function populatePkg(site, pkg) {
	var version = pkg.version || site.branch || site.data.version;
	var pair = `${site.id}/${version}`;
	var siteModuleDir = Path.join(pkg.dir, 'node_modules', pkg.name);
	return fs.readFile(Path.join(siteModuleDir, "package.json")).then(function(buf) {
		return JSON.parse(buf.toString());
	}).then(function(sitePkg) {
		// configure directories/elements for each dependency
		return Promise.all(Object.keys(sitePkg.dependencies || {}).map(function(subModule) {
			var moduleDir = Path.join(pkg.dir, 'node_modules', subModule);
			return exports.config(moduleDir, pair, subModule, pkg);
		})).then(function() {
			// configure directories/elements for the module itself (so it can
			// overrides what the dependencies have installed
			return exports.config(siteModuleDir, pair, pkg.name, pkg);
		});
	}).then(function() {
		return pkg;
	});
}

function getPkg(pkgDir) {
	var pkgPath = pkgDir != null ? Path.join(pkgDir, 'package.json') : null;
	var pkg = {
		dir: pkgDir,
		path: pkgPath,
		directories: [],
		elements: []
	};
	if (pkgDir == null) return Promise.resolve(pkg);
	return fs.readFile(pkgPath).then(function(buf) {
		var obj = JSON.parse(buf.toString());
		var deps = Object.keys(obj.dependencies);
		if (!deps.length) return pkg;
		// if siteModule is a github url, version will be <siteModule>#hash
		// if siteModule is a real package, version is a real version
		var name = deps[0];
		var version = obj.dependencies[name];
		if (version.indexOf('#') > 0) version = version.split('#').pop();
		// version is a string here so this boolean check is all right
		if (!version || version.indexOf('/') >= 0) version = null;
		pkg.name = name;
		if (version != null) pkg.version = version;
		return pkg;
	}).catch(function(err) {
		return pkg;
	});
}

function getDependencies(root, name, list, deps) {
	if (!deps) deps = {};
	var dir = Path.join(root, 'node_modules', name);
	if (deps[dir]) return;
	return fs.readFile(Path.join(dir, 'package.json')).catch(function(err) {
		// nested dep
	}).then(function(buf) {
		if (!buf || deps[dir]) return;
		deps[dir] = true;
		var pkg = JSON.parse(buf);
		var pst = (pkg.scripts && pkg.scripts.postinstall || "").split(' ');
		if (pst.includes("postinstall")) {
			list.push({pkg, dir});
		}
		return Promise.all(Object.keys(pkg.dependencies || {}).map(function(name) {
			return getDependencies(root, name, list, deps);
		}));
	});
}

function runPostinstall(dir, name, opt) {
	var list = [];
	return getDependencies(dir, name, list).then(function() {
		return Promise.all(list.reverse().map(function({pkg, dir}) {
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
			});
		}));
	});
}
