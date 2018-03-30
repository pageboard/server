var Path = require('path');
var pify = require('util').promisify;
var mkdirp = pify(require('mkdirp'));
var debug = require('debug')('pageboard:core');

var fs = {
	writeFile: pify(require('fs').writeFile),
	readFile: pify(require('fs').readFile),
	readdir: pify(require('fs').readdir),
	stat: pify(require('fs').stat),
	unlink: pify(require('fs').unlink),
	symlink: pify(require('fs').symlink)
};

exports.install = function(opt, siteDir, siteModule, siteVersion) {
	if (!siteModule) {
		return Promise.resolve();
	}
	var pkgPath = Path.join(siteDir, 'package.json');
	return mkdirp(siteDir).then(function() {
		return getModuleVersion(pkgPath).catch(function() {}).then(function(moduleInfo) {
			var version = moduleInfo && moduleInfo.version;
			if (version) {
				if (version == "@latest" || version == siteVersion) return false;
			}
			return true;
		}).then(function(install) {
			if (!install) return false;
			return fs.writeFile(pkgPath, JSON.stringify({
				dependencies: {} // npm will populate it for us
			})).then(function() {
				return true;
			});
		});
	}).then(function(install) {
		if (siteVersion) {
			if (siteModule.indexOf('/') > 0 && !siteModule.startsWith('@')) siteModule += "#";
			else siteModule += "@";
			siteModule += siteVersion;
		}
		if (!install) {
			console.info("skipped install", siteModule);
			return;
		}
		console.info("install", siteModule);
		var baseEnv = {
			HOME: process.env.HOME,
			PATH: process.env.PATH
		};
		if (opt.env == "development" && process.env.SSH_AUTH_SOCK) {
			// some local setup require to pass this to be able to use ssh keys
			baseEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
		}
		if (opt.core.installer == "yarn") {
			return All.utils.spawn(opt.installerPath, [
				"--non-interactive",
				"--ignore-optional",
				"--prefer-offline",
				"--production",
				"--no-lockfile",
				"--silent",
				"add", siteModule
			], {
				cwd: siteDir,
				timeout: 60 * 1000,
				env: baseEnv
			});
		} else {
			return All.utils.spawn(opt.installerPath, [
				"install",
				"--save", siteModule
			], {
				cwd: siteDir,
				timeout: 60 * 1000,
				env: Object.assign(baseEnv, {
					npm_config_userconfig: '', // attempt to disable user config
					npm_config_ignore_scripts: 'false',
					npm_config_loglevel: 'error',
					npm_config_progress: 'false',
					npm_config_package_lock: 'false',
					npm_config_only: 'prod',
					npm_config_prefer_offline: 'true'
				})
			});
		}
	}).then(function(out) {
		if (out) debug(out);
		return getModuleVersion(pkgPath);
	});
};

exports.config = function(moduleDir, id, module, config) {
	debug("Module directory", module, moduleDir);
	return fs.readFile(Path.join(moduleDir, 'package.json')).catch(function(err) {
		// it's ok to not have a package.json here
		return false;
	}).then(function(buf) {
		var dstDir = id != 'pageboard' ? Path.join('/', '.files', id, module) : '/.' + id;
		if (buf === false) {
			console.info(`${id} > ${module} has no package.json, mounting the module directory`);
			config.directories.push({
				from: Path.resolve(moduleDir),
				to: dstDir
			});
			return;
		}
		var meta = JSON.parse(buf);
		if (!meta.pageboard) {
			return; // nothing to do
		}
		var directories = meta.pageboard.directories || [];
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
				to: to
			});
		});

		var elements = meta.pageboard.elements || [];
		if (!Array.isArray(elements)) elements = [elements];
		debug("processing elements from", moduleDir, elements);
		return Promise.all(elements.map(function(path) {
			var absPath = Path.resolve(moduleDir, path);
			return fs.stat(absPath).then(function(stat) {
				if (stat.isDirectory()) return fs.readdir(absPath).then(function(paths) {
					// make sure files are ordered by basename
					paths.sort(function(a, b) {
						a = Path.basename(a);
						b = Path.basename(b);
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
						config.elements.push(path);
					}
				});
			});
		}));
	}).catch(function(err) {
		console.error(`Error: ${id} dependency ${module} cannot be extracted`, err);
	});
};


function getModuleVersion(pkgPath) {
	return fs.readFile(pkgPath).then(function(buf) {
		var pkg = JSON.parse(buf.toString());
		var deps = Object.keys(pkg.dependencies);
		if (!deps.length) return;
		// if siteModule is a github url, version will be <siteModule>#hash
		// if siteModule is a real package, version is a real version
		var name = deps[0];
		var version = pkg.dependencies[name];
		if (version.indexOf('#') > 0) version = version.split('#').pop();
		if (!version || version.indexOf('/') >= 0) version = null;
		return {
			name: name,
			version: version
		};
	});
}
