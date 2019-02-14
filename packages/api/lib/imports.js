var Path = require('path');
var pify = require('util').promisify;
var toSource = require('tosource');

var fs = {
	readFile: pify(require('fs').readFile),
	writeFile: pify(require('fs').writeFile)
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

	sortPriority(allDirs);
	sortPriority(allElts);

	return Promise.all(allElts.map(function(eltObj) {
		return fs.readFile(eltObj.path);
	})).then(function(bufs) {
		var elts = {};
		var names = [];
		var context = {};
		bufs.forEach(function(buf, i) {
			var path = allElts[i].path;
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
		var standalones = [];
		site.$pagetypes = [];
		Object.keys(eltsMap).forEach(function(key) {
			var el = eltsMap[key];
			if (!el.name) el.name = key;
			if (el.standalone) {
				standalones.push(el);
				if (el.group == "page") site.$pagetypes.push(el.name);
			}
		});
		site.$standalones = {};
		return Promise.all(standalones.map(function(el) {
			el = eltsMap[el.name] = Object.assign({}, el);
			return bundle(site, pkg, el);
		})).then(function() {
			return bundleSource(site, pkg, '', 'services', All.services).then(function(path) {
				site.$services = path;
			});
		});
	}).then(function() {
		site.$scripts = pkg.eltsMap.site.scripts;
		site.$resources = pkg.eltsMap.site.resources;
		site.$stylesheets = pkg.eltsMap.site.stylesheets;
		site.constructor = pkg.Block;
		delete pkg.eltsMap;
		delete pkg.Block;
	});
};

function sortPriority(list) {
	list.sort(function(a, b) {
		var pa = a.priority;
		var pb = b.priority;
		if (pa == pb) return 0;
		if (pa < pb) return -1;
		else return 1;
	});
}

function bundle(site, pkg, rootEl) {
	var list = listDependencies(rootEl.group, pkg.eltsMap, rootEl);
	list.sort(function(a, b) {
		return (a.priority || 0) - (b.priority || 0);
	});
	var scripts = filter(list, 'scripts');
	var styles = filter(list, 'stylesheets');
	var prefix = `${rootEl.name}-`;

	var eltsMap = {};
	list.forEach(function(elt) {
		if (!elt.standalone) {
			elt = Object.assign({}, elt);
			delete elt.scripts;
			delete elt.stylesheets;
		}
		eltsMap[elt.name] = elt;
	});
	var metaEl = site.$standalones[rootEl.name] = {
		group: rootEl.group
	};

	var p;

	if (site.data.env == "dev" || !pkg.dir || !site.href) {
		p = Promise.resolve();
		rootEl.scripts = scripts;
		rootEl.stylesheets = styles;
	} else {
		p = Promise.all([
			All.statics.bundle(site, pkg, scripts, `${prefix}scripts.js`),
			All.statics.bundle(site, pkg, styles, `${prefix}styles.css`)
		]);
	}
	return p.then(function(both) {
		if (both && both.length == 2) {
			rootEl.scripts = both[0];
			rootEl.stylesheets = both[1];
		}

		return bundleSource(site, pkg, prefix, 'elements', eltsMap).then(function(path) {
			metaEl.bundle = path;
			metaEl.scripts = rootEl.scripts;
			metaEl.stylesheets = rootEl.stylesheets;
		});
	});
}

function bundleSource(site, pkg, prefix, name, obj) {
	var filename = `${prefix}${name}.js`;
	var version = site.data.version;
	if (version == null) version = 'master';
	var fileurl = `/.files/${version}/_${filename}`;
	var fileruntime = All.statics.resolve(site.id, fileurl);

	var str = `Pageboard.${name} = Object.assign(Pageboard.${name} || {}, ${toSource(obj)});`;

	return fs.writeFile(fileruntime, str).then(function() {
		return All.statics.bundle(site, pkg, [fileurl], filename);
	}).then(function(paths) {
		return paths[0];
	});
}

function listDependencies(rootGroup, eltsMap, el, list=[], sieve={}) {
	var word;
	if (typeof el == "string") {
		word = el;
		el = eltsMap[word];
		if (!el) {
			var isGroup = false;
			Object.keys(eltsMap).forEach(function(key) {
				var gel = eltsMap[key];
				if (!gel.group) {
					// non-rendering elements
					if (rootGroup == "page" && !gel.render && !gel.html && (gel.stylesheets || gel.scripts)) {
						listDependencies(rootGroup, eltsMap, gel, list, sieve);
					}
				} else if (gel.standalone) {
					// prevent loops
				} else if (gel.group.split(" ").includes(word)) {
					isGroup = true;
					listDependencies(rootGroup, eltsMap, gel, list, sieve);
				}
			});
			if (!isGroup) console.error("Cannot find element");
		}
	}
	if (!el || sieve[el.name]) return list;
	list.push(el);
	sieve[el.name] = true;
	var contents = el.contents;
	if (!contents) {
		if (el.standalone && el.group) contents = el.group;
		else return list;
	}
	if (typeof contents == "string") contents = {content: contents};
	Object.keys(contents).forEach(function(key) {
		var val = contents[key];
		var spec = typeof val == "string" ? val : val.spec;
		if (!spec) return;
		spec.split(/\W+/).filter(x => !!x).forEach(function(word) {
			if (word == "text" || word == "page") return;
			if (!sieve[word]) {
				listDependencies(rootGroup, eltsMap, word, list, sieve);
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
	if (!list) return [];
	if (typeof list == "string") list = [list];
	return list.map(function(path) {
		if (path == null) {
			console.warn("null path in", file);
			return;
		}
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
			elements: new Proxy(elts, new MapProxy(context))
		}
	};
	script.runInNewContext(sandbox, {
		filename: context.path,
		timeout: 1000
	});

	ArrProxy.create(context);
	var elt;
	for (var name in elts) {
		elt = elts[name];
		if (!elt) {
			console.warn("element", name, "is not defined at", context.path);
			continue;
		}

		names.push(name);

		['scripts', 'stylesheets', 'resources'].forEach(function(what) {
			elt[what] = new Proxy(absolutePaths(elt[what], context), new ArrProxy(context));
		});

		Object.defineProperty(elts, name, {
			value: new Proxy(elt, new EltProxy(name, context)),
			writable: false,
			enumerable: false,
			configurable: false
		});
	}
}

class MapProxy {
	constructor(context) {
		this.context = context;
	}
	set(obj, key, val) {
		if (obj.hasOwnProperty(key)) {
			if (key == "user" || key == "priv") {
				console.error(`Modifying ${key} element is not allowed`);
				return false;
			}
			console.error("Please avoid setting", key, "in", this.context.path, " - using Object.assign instead");
			Object.assign(obj[key], val);
			return false;
		}
		return Reflect.set(obj, key, val);
	}
}

class EltProxy {
	constructor(name, context) {
		this.name = name;
		this.context = context;
	}
	set(elt, key, val) {
		if (this.name == "user" || this.name == "priv") {
			console.error(`Modifying ${this.name} element properties is not allowed`);
			return false;
		}
		if (key == "scripts" || key == "stylesheets" || key == "resources") {
			val = new Proxy(absolutePaths(val, this.context), new ArrProxy(this.context));
		}
		return Reflect.set(elt, key, val);
	}
}

class ArrProxy {
	static create(context) {
		return new this(context);
	}
	constructor(context) {
		this.context = context;
	}
	set(arr, key, val) {
		if (typeof key == "number" && val != null) {
			val = absolutePaths(val, this.context);
			if (val.length == 1) val = val[0];
			else throw new Error(`Cannot set ${this.context}.${key} with ${val}`);
		}
		return Reflect.set(arr, key, val);
	}
	get(arr, key) {
		if (['push', 'unshift'].includes(key)) {
			var context = this.context;
			return function() {
				var args = absolutePaths(Array.from(arguments), context);
				return Array.prototype[key].apply(arr, args);
			};
		}
		return Reflect.get(arr, key);
	}
}

