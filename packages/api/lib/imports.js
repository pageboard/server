var Path = require('path');
var pify = require('util').promisify;
var toSource = require('tosource');

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

	return Promise.all(allElts.map(function(path) {
		return fs.readFile(path);
	})).then(function(bufs) {
		var elts = {};
		var names = [];
		var context = {};
		bufs.forEach(function(buf, i) {
			var path = allElts[i];
			context.mount = getMountPath(path, id, allDirs);
			context.path = path;
			loadFromFile(buf, elts, names, context);
		});

		var eltsMap = {};
		names.forEach(function(name) {
			var elt = Object.assign({}, elts[name]); // drop proxy
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
		var pages = [];
		Object.keys(eltsMap).forEach(function(key) {
			var el = eltsMap[key];
			if (!el.name) el.name = key;
			if (el.group == "page") pages.push(el);
		});
		return pages.reduce(function(p, page) {
			return p.then(function() {
				page = eltsMap[page.name] = Object.assign({}, page);
				return bundle(site, pkg, page);
			});
		}, Promise.resolve());
	}).then(function() {
		site.constructor = pkg.Block;
		site.$source = toSource(pkg.eltsMap);
		site.$resources = pkg.eltsMap.site.resources;
		delete pkg.eltsMap;
		delete pkg.Block;
	});
};

function bundle(site, pkg, page) {
	var list = listDependencies(site.id, pkg.eltsMap, page);
	list.sort(function(a, b) {
		return (a.priority || 0) - (b.priority || 0);
	});
	var scripts = filter(list, 'scripts');
	var styles = filter(list, 'stylesheets');

	if (site.data.env == "dev" || !pkg.dir || !site.href) {
		page.scripts = scripts;
		page.stylesheets = styles;
		return Promise.resolve();
	}

	var prefix = page.name == "page" ? "" : `${page.name}-`;

	return Promise.all([
		All.statics.bundle(site, pkg, scripts, `${prefix}scripts.js`),
		All.statics.bundle(site, pkg, styles, `${prefix}styles.css`)
	]).then(function(both) {
		page.scripts = both[0];
		page.stylesheets = both[1];
	});
}

function listDependencies(id, eltsMap, el, list=[], sieve={}) {
	var word;
	if (typeof el == "string") {
		word = el;
		el = eltsMap[word];
		if (!el) {
			var isGroup = false;
			Object.keys(eltsMap).forEach(function(key) {
				var el = eltsMap[key];
				if (!el.group) {
					if (!el.render && (el.stylesheets || el.scripts)) {
						listDependencies(id, eltsMap, el, list, sieve);
					}
					return;
				} else if (el.group == "page") {
					return;
				}
				if (el.group.split(" ").indexOf(word)) {
					isGroup = true;
					listDependencies(id, eltsMap, el, list, sieve);
				}
			});
			if (!isGroup) console.error("Cannot find element");
		}
	}
	if (!el || sieve[el.name]) return list;
	list.push(el);
	sieve[el.name] = true;
	if (!el.contents) return list;
	var contents = el.contents;
	if (typeof contents == "string") contents = {content: contents};
	Object.keys(contents).forEach(function(key) {
		var val = contents[key];
		var spec = typeof val == "string" ? val : val.spec;
		if (!spec) return;
		spec.split(/\W+/).filter(x => !!x).forEach(function(word) {
			if (word == "text" || word == "page") return;
			if (!sieve[word]) {
				listDependencies(id, eltsMap, word, list, sieve);
			}
		});
	});
	return list;
}

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
	if (!mount) return;
	var basePath = id ? mount.to.replace(id + "/", "") : mount.to;
	var eltPathname = Path.join(basePath, eltPath.substring(mount.from.length));
	return Path.dirname(eltPathname);
}

function absolutePaths(list, file) {
	if (!list) return list;
	if (typeof list == "string") list = [list];
	return list.map(function(path) {
		if (path.startsWith('/') || /^(http|https|data):/.test(path)) {
			return path;
		}
		if (!file.mount) {
			console.error("Cannot mount", path, "from element defined in", file.path);
			return;
		}
		return Path.join(file.mount, path);
	}).filter(x => !!x);
}

function loadFromFile(buf, elts, names, context) {
	var script = new vm.Script(buf, {
		filename: context.path
	});
	var sandbox = {
		Pageboard: {
			elements: elts
		}
	};
	script.runInNewContext(sandbox, {
		filename: context.path,
		timeout: 1000
	});

	var elt;
	for (var name in elts) {
		elt = elts[name];
		if (!elt) {
			console.warn("element", name, "is not defined at", context.path);
			continue;
		}
		['scripts', 'stylesheets', 'resources'].forEach(function(what) {
			var list = absolutePaths(elt[what], context);
			if (list) elt[what] = list;
			else delete elt[what];
		});
		names.push(name);
		Object.defineProperty(elts, name, {
			value: new Proxy(elt, new EltProxy(name, context)),
			writable: false,
			enumerable: false,
			configurable: false
		});
	}
}

class EltProxy {
	constructor(name, context) {
		this.name = name;
		this.context = context;
	}
	set(elt, key, val) {
		if (this.name == "user") return false; // changing user is forbidden
		if (key == "scripts" || key == "stylesheets" || key == "resources") {
			val = absolutePaths(val, this.context);
		}
		return Reflect.set(elt, key, val);
	}
}
