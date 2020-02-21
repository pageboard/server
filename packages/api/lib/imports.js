const Path = require('path');
const toSource = require('tosource');

const fs = require('fs').promises;
const vm = require('vm');

exports.install = function(site, pkg, All) {
	var elements = pkg.elements;
	var directories = pkg.directories;
	Log.imports("installing", id, elements, directories);
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
		var groups = {};
		var bundles = {};

		names.forEach(function(name) {
			var el = Object.assign({}, elts[name]); // drop proxy
			el.name = name;
			// backward compatibility with 0.7 extensions names, dropped in favor of output
			if (updateExtension(el, eltsMap)) return;
			eltsMap[name] = el;

			if (el.group) el.group.split(/\s+/).forEach(function(gn) {
				if (gn == "page") {
					// backward compatibility with < client@0.7
					el.standalone = el.bundle = true;
				}
				var group = groups[gn];
				if (!group) group = groups[gn] = [];
				if (!group.includes(name)) group.push(name);
			});
			if (el.bundle === true) {
				bundles[el.name] = {
					meta: el,
					list: []
				};
			} else if (typeof el.bundle == "string") {
				var bundle = bundles[el.bundle];
				if (!bundle) throw new Error(`${el.bundle} must be declared before ${el.name}`);
				bundle.list.push(el);
			}
		});

		var Block = All.api.Block.extendSchema(id, eltsMap);
		if (id) {
			pkg.Block = Block;
			pkg.eltsMap = eltsMap;
			site.$groups = groups; // needed by All.send's filterResponse
			site.$bundles = bundles;
			site.constructor = Block; // gni ?
		} else {
			All.api.Block = Block;
		}
	}).catch(function(err) {
		console.error(err);
		throw err;
	});
};

function updateExtension(el, eltsMap) {
	var extPage = {
		'.mail': 'mail'
	}[el.name];
	if (!extPage) return;
	var page = eltsMap[extPage];
	page.scripts = (page.scripts || []).concat(el.scripts);
	if (el.prerender) page.output = el.prerender;
	if (el.print) page.output = Object.assign({}, page.output, {pdf: true});
	return true;
}

exports.bundle = function(site, pkg) {
	const gDone = {};
	const eDone = {};
	return Promise.all(Object.values(site.$bundles).map(function(bundle) {
		return doBundle(site, pkg, bundle, gDone, eDone);
	})).then(function() {
		return bundleSource(site, pkg, null, 'services', All.services).then(function(path) {
			site.$services = path;
		});
	}).then(function() {
		site.$scripts = pkg.eltsMap.site.scripts;
		site.$resources = pkg.eltsMap.site.resources;
		site.$stylesheets = pkg.eltsMap.site.stylesheets;
		delete pkg.eltsMap;
		delete pkg.Block;
	});
};

function sortPriority(list) {
	list.sort(function(a, b) {
		var pa = a.priority;
		var pb = b.priority;
		if (pa == pb) {
			if (a.path && b.path) return Path.basename(a.path).localeCompare(Path.basename(b.path));
			else return 0;
		}
		if (pa < pb) return -1;
		else return 1;
	});
}

function doBundle(site, pkg, bundle, gDone, eDone) {
	var meta = bundle.meta;
	bundle.gDone = {};
	bundle.eDone = {};
	listDependencies(site, pkg.eltsMap, bundle, meta.name, gDone, eDone);
	delete bundle.gDone;
	delete bundle.eDone;
	var list = bundle.list;
	delete bundle.list;
	list.sort(function(a, b) {
		return (a.priority || 0) - (b.priority || 0);
	});
	Log.imports(meta.name, "contains:\n", list.map((x) => x.name).join("\n "));

	var scripts = sortElements(list, 'scripts');
	var styles = sortElements(list, 'stylesheets');
	var prefix = meta.name;

	var eltsMap = {};
	list.forEach(function(el) {
		if (!el.standalone) {
			el = Object.assign({}, el);
			delete el.scripts;
			delete el.stylesheets;
		}
		eltsMap[el.name] = el;
	});
	bundle.elements = Object.keys(eltsMap);

	return Promise.all([
		All.statics.bundle(site, pkg.dir, scripts, `${prefix}.js`),
		All.statics.bundle(site, pkg.dir, styles, `${prefix}.css`)
	]).then(function([scripts, stylesheets]) {
		// bundleSource will serialize bundle.meta, set these before
		meta.scripts = scripts;
		meta.stylesheets = stylesheets;

		return bundleSource(site, pkg, prefix, 'elements', eltsMap).then(function(path) {
			// All.send looks into bundle.meta and return all deps - not needed for pages
			Object.assign(bundle.meta, {
				scripts: meta.group != "page" ? scripts : [],
				stylesheets: meta.group != "page" ? stylesheets : [],
				resources: meta.resources,
				bundle: path
			});
		});
	});
}

function bundleSource(site, pkg, prefix, name, obj) {
	if (prefix && prefix.startsWith('ext-')) return Promise.resolve();
	var filename = [prefix, name].filter(Boolean).join('-') + '.js';
	var version = site.data.version;
	if (version == null) version = site.branch;
	var sourceUrl = `/.files/${version}/${filename}`;
	var sourcePath = All.statics.resolve(site.id, sourceUrl);
	var str = `Pageboard.${name} = Object.assign(Pageboard.${name} || {}, ${toSource(obj)});`;
	return fs.writeFile(sourcePath, str).then(function() {
		return All.statics.bundle(site, pkg.dir, [sourceUrl], filename);
	}).then(function(paths) {
		return paths[0];
	});
}

function listDependencies(site, elts, bundle, name, gDone, eDone) {
	var root = bundle.meta;
	if (!name) name = root.name;
	const el = elts[name];
	if (!el || root.group != "page" && eDone[name] || bundle.eDone[name]) return;
	if (el.bundle === true && name != root.name) return;
	if (typeof el.bundle == "string" && el.bundle != root.name) return;
	bundle.list.push(el);
	bundle.eDone[name] = eDone[name] = true;
	var contents = All.api.Block.normalizeContents(el.contents);
	if (contents) contents.forEach(function(content) {
		if (!content.nodes) return;
		content.nodes.split(/\W+/).filter(Boolean).forEach(function(word) {
			if (word == "text") return;
			var wordGroup = site.$groups[word];
			if (wordGroup) {
				if (root.group != "page" && gDone[word] || bundle.gDone[word]) return;
				bundle.gDone[name] = gDone[word] = true;
			} else {
				wordGroup = [word];
			}
			if (word == root.name) {
				console.warn("contents contains root group", root.name, name, contents);
				return;
			}
			wordGroup.forEach((sub) => {
				listDependencies(site, elts, bundle, sub, gDone, eDone);
			});
		});
	});
}

function sortElements(elements, prop) {
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
	if (!list) return;
	if (typeof list == "string") list = [list];
	var obj = Array.isArray(list) ? null : {};
	var arr = Object.entries(list).map(function([key, path]) {
		if (path == null) {
			console.warn("null path in", file);
			return;
		}
		if (path.startsWith('/') || /^(http|https|data):/.test(path)) {
			// do nothing
		} else if (!file.mount) {
			console.error("Cannot mount", path, "from element defined in", file.path);
			return;
		} else {
			path = Path.join(file.mount, path);
		}
		if (obj) obj[key] = path;
		else return path;
	});
	if (obj) return obj;
	else return arr.filter(x => !!x);
}

function loadFromFile(buf, elts, names, context) {
	var script = new vm.Script(buf, {
		filename: context.path
	});
	var sandbox = {
		exports: new Proxy(elts, new MapProxy(context))
	};
	// let's keep compatibility for now
	sandbox.Pageboard = {
		elements: sandbox.exports
	};
	script.runInNewContext(sandbox, {
		filename: context.path,
		timeout: 1000
	});

	AbsoluteProxy.create(context);
	var elt;
	for (var name in elts) {
		elt = elts[name];
		if (!elt) {
			console.warn("element", name, "is not defined at", context.path);
			continue;
		}

		names.push(name);
		elt = new Proxy(elt, new EltProxy(name, context));
		Object.defineProperty(elts, name, {
			value: elt,
			writable: false,
			enumerable: false,
			configurable: false
		});
		if (name != "user" && name != "priv") {
			elt.scripts = elt.scripts || [];
			elt.stylesheets = elt.stylesheets || [];
			elt.resources = elt.resources || {};
		}
	}
}

class MapProxy {
	constructor(context) {
		this.context = context;
	}
	set(obj, key, val) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
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
			val = new Proxy(absolutePaths(val, this.context), new AbsoluteProxy(this.context));
		}
		return Reflect.set(elt, key, val);
	}
	get(elt, key) {
		var val = Reflect.get(elt, key);
		if (["scripts", "stylesheets", "polyfills"].includes(key)) {
			if (val == null) {
				val = [];
				Reflect.set(elt, key, val);
			}
		} else if (["resources", "properties", "csp", "filters"].includes(key)) {
			if (val == null) {
				val = {};
				Reflect.set(elt, key, val);
			}
		}
		return val;
	}
}

class AbsoluteProxy {
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

