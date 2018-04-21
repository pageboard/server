var Path = require('path');
var pify = require('util').promisify;
var toSource = require('tosource');
var exec = pify(require('child_process').exec);

var fs = {
	readFile: pify(require('fs').readFile)
};
var vm = require('vm');
var debug = require('debug')('pageboard:imports');

exports.install = function(site, pkg, All) {
	var elements = pkg.elements;
	var directories = pkg.directories;
	debug("installing", id, elements, directories);
	var id = site ? site.id : null;
	var allDirs = id ? All.opt.directories.concat(directories) : directories;
	var allElts = id ? All.opt.elements.concat(elements) : elements;
	var elts = {};
	var names = [];
	var context = {};
	return Promise.all(allElts.map(function(path) {
		return importElements(path, context, elts, names);
	})).then(function() {
		var eltsMap = {};
		names.forEach(function(name) {
			var elt = Object.assign({}, elts[name]); // drop proxy
			rewriteElementPaths(name, elt, id, allDirs);
			eltsMap[name] = elt;
		});
		var Block = All.api.Block.extendSchema(id, eltsMap);
		if (id) {
			pkg.Block = Block;
			pkg.eltsMap = eltsMap;
		} else {
			All.api.Block = Block;
		}
	}).catch(function(err) {
		console.error(err);
		throw err;
	});
};

exports.validate = function(site, pkg) {
	return Promise.resolve().then(function() {
		var eltsMap = pkg.eltsMap;
		var env = site.data.env;
		var list = Object.keys(eltsMap).map(function(key) {
			var el = eltsMap[key];
			if (!el.name) el.name = key;
			return el;
		}).sort(function(a, b) {
			return (a.priority || 0) - (b.priority || 0);
		});
		eltsMap.page = Object.assign({}, eltsMap.page);

		var scripts = filter(list, 'scripts');
		var styles = filter(list, 'stylesheets');

		if (env == "dev" || !pkg.dir || !site.href) {
			eltsMap.page.scripts = scripts;
			eltsMap.page.stylesheets = styles;
			return Promise.resolve();
		}

		return Promise.all([
			All.statics.bundle(site, scripts, `scripts.js`),
			All.statics.bundle(site, styles, `styles.css`)
		]).then(function(both) {
			eltsMap.page.scripts = both[0];
			eltsMap.page.stylesheets = both[1];
		});
	}).then(function() {
		site.constructor = pkg.Block;
		site.$source = toSource(pkg.eltsMap);
		delete pkg.eltsMap;
		delete pkg.Block;
	});
};

function filter(elements, prop) {
	var map = {};
	var res = [];
	elements.forEach(function(el) {
		var list = el[prop];
		if (!list) return;
		delete el[prop];
		if (typeof list == "string") list = [list];
		var url, prev;
		for (var i=0; i < list.length; i++) {
			url = list[i];
			prev = map[url];
			if (prev) {
				if (el.priority != null) {
					if (prev.priority == null) {
						// move prev url on top of res
						res = res.filter(function(lurl) {
							return lurl != url;
						});
					} else if (prev.priority != el.priority) {
						console.warn(prop, url, "declared in element", el.name, "with priority", el.priority, "is already declared in element", prev.name, "with priority", prev.priority);
						continue;
					} else {
						continue;
					}
				} else {
					continue;
				}
			}
			map[url] = el;
			res.push(url);
		}
	});
	return res;
}

function getMountPath(eltPath, id, directories) {
	var mount = directories.find(function(mount) {
		return eltPath.startsWith(mount.from);
	});
	if (!mount) {
		console.warn(`Warning: element ${eltPath} cannot be mounted`);
		return;
	}
	var basePath = id ? mount.to.replace(id + "/", "") : mount.to;
	var eltPathname = Path.join(basePath, eltPath.substring(mount.from.length));
	return Path.dirname(eltPathname);
}

function rewriteElementPaths(name, elt, id, directories) {
	['scripts', 'stylesheets', 'resources'].forEach(function(what) {
		if (elt[what] != null) {
			elt[what] = elt[what]
			.map(function(obj) {
				var dir = getMountPath(obj.base, id, directories);
				if (!dir) {
					console.error("Could not find mount path for", obj.base, id);
					return;
				}
				if (obj.path.startsWith('/') || /^(http|https|data):/.test(obj.path)) return obj.path;
				return Path.join(dir, obj.path);
			})
			.filter(x => !!x);
		} else {
			delete elt[what];
		}
	});
}

function importElements(path, context, elts, names) {
	return fs.readFile(path).then(function(buf) {
		context.path = path;
		var script = new vm.Script(buf, {
			filename: path
		});
		var sandbox = {
			Pageboard: {
				elements: elts
			}
		};
		script.runInNewContext(sandbox, {
			filename: path,
			timeout: 1000
		});

		var elt;
		for (var name in elts) {
			elt = elts[name];
			if (!elt) {
				console.warn("element", name, "is not defined at", path);
				continue;
			}
			['scripts', 'stylesheets', 'resources'].forEach(function(what) {
				var list = elt[what];
				if (!list) return;
				if (typeof list == "string") list = [list];
				elt[what] = list.map(function(str) {
					return {base: path, path: str};
				});
			});
			names.push(name);
			Object.defineProperty(elts, name, {
				value: new Proxy(elt, new EltProxy(context, name)),
				writable: false,
				enumerable: false,
				configurable: false
			});
		}
	});
}

class EltProxy {
	constructor(context, name) {
		this.name = name;
		this.context = context;
	}
	set(elt, key, val) {
		if (this.name == "user") return false; // changing user is forbidden
		if (key == "scripts" || key == "stylesheets" || key == "resources") {
			val = val.map(function(str) {
				return {
					path: str,
					base: this.context.path // this value change with path by design
				};
			}, this);
		}
		return Reflect.set(elt, key, val);
	}
}
