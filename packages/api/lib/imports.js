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
			var el = elts[name] = Object.assign({}, elts[name]); // drop proxy
			el.name = name;
			// backward compatibility with 0.7 extensions names, dropped in favor of output
			if (updateExtension(el, eltsMap)) return;
			eltsMap[name] = el;
			var isPage = false; // backward compatibility with < client@0.7
			if (el.group) el.group.split(/\s+/).forEach(function(gn) {
				if (gn == "page") isPage = true;
				var group = groups[gn];
				if (!group) group = groups[gn] = [];
				if (!group.includes(name)) group.push(name);
			});
			if (isPage) {
				if (!el.standalone) el.standalone = true;
				if (!el.bundle) el.bundle = true;
			}
			if (el.bundle === true) {
				bundles[name] = {};
			} else if (el.bundle) {
				if (!bundles[el.bundle]) bundles[el.bundle] = {};
				if (!bundles[el.bundle].list) bundles[el.bundle].list = [];
				bundles[el.bundle].list.push(el);
			}
		});

		var Block = All.api.Block.extendSchema(id, eltsMap);
		if (id) {
			pkg.Block = Block;
			pkg.eltsMap = eltsMap;
			pkg.groups = groups;
			site.$pages = groups.page;
			site.$bundles = {};
			site.constructor = Block; // gni ?
		} else {
			All.api.Block = Block;
		}
		return bundles;
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

exports.validate = function(site, pkg, bundles) {
	var eltsMap = pkg.eltsMap;
	return Promise.all(Object.entries(bundles).map(function([name, {list}]) {
		let el = eltsMap[name];
		return bundle(site, pkg, el, list);
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
		const pa = a.priority;
		const pb = b.priority;
		if (pa == pb) {
			if (a.path && b.path) return Path.basename(a.path).localeCompare(Path.basename(b.path));
			else return 0;
		}
		if (pa < pb) return -1;
		else return 1;
	});
}

function bundle(site, pkg, rootEl, cobundles=[]) {
	let list = listDependencies(pkg, rootEl.group, rootEl, cobundles.slice());
	list.sort(function(a, b) {
		return (a.priority || 0) - (b.priority || 0);
	});
	const scripts = sortElements(list, 'scripts');
	const styles = sortElements(list, 'stylesheets');
	const prefix = rootEl.name;

	const eltsMap = {};
	list.forEach(function(el) {
		if (!el.standalone) {
			el = Object.assign({}, el);
			delete el.scripts;
			delete el.stylesheets;
		}
		eltsMap[el.name] = el;
	});
	const metaEl = Object.assign({}, rootEl);
	const metaKeys = Object.keys(eltsMap);
	site.$bundles[rootEl.name] = {
		meta: metaEl,
		elements: metaKeys
	};

	return Promise.all([
		All.statics.bundle(site, pkg, scripts, `${prefix}.js`),
		All.statics.bundle(site, pkg, styles, `${prefix}.css`)
	]).then(function([scripts, styles]) {
		rootEl.scripts = scripts;
		rootEl.stylesheets = styles;
		cobundles.forEach((el) => {
			if (el.group == "page") {
				pkg.eltsMap[el.name].scripts = scripts;
				pkg.eltsMap[el.name].stylesheets = styles;
			}
		});

		return bundleSource(site, pkg, prefix, 'elements', eltsMap).then(function(path) {
			if (path) metaEl.bundle = path;
			metaEl.scripts = rootEl.group != "page" ? rootEl.scripts : [];
			metaEl.stylesheets = rootEl.group != "page" ? rootEl.stylesheets : [];
			metaEl.resources = rootEl.resources;
			cobundles.forEach((el) => {
				if (el.group == "page") {
					site.$bundles[el.name] = {
						meta: Object.assign({}, el, {
							scripts: metaEl.scripts,
							stylesheets: metaEl.stylesheets,
							resources: metaEl.resources,
							bundle: metaEl.bundle
						}),
						elements: metaKeys
					};
				}
			});
		});
	});
}

function bundleSource(site, pkg, prefix, name, obj) {
	if (prefix && prefix.startsWith('ext-')) return Promise.resolve();
	const filename = [prefix, name].filter(Boolean).join('-') + '.js';
	let version = site.data.version;
	if (version == null) version = site.branch;
	const sourceUrl = `/.files/${version}/${filename}`;
	const sourcePath = All.statics.resolve(site.id, sourceUrl);
	const str = `Pageboard.${name} = Object.assign(Pageboard.${name} || {}, ${toSource(obj)});`;
	return fs.writeFile(sourcePath, str).then(function() {
		return All.statics.bundle(site, pkg, [sourceUrl], filename);
	}).then(function(paths) {
		return paths[0];
	});
}

function listDependencies(pkg, rootGroup, el, list=[], gDone={}, eDone={}) {
	if (!el || eDone[el.name]) return list;
	var elts = pkg.eltsMap;
	list.push(el);
	eDone[el.name] = true;
	var contents = All.api.Block.normalizeContents(el.contents);
	if (contents) contents.forEach(function(content) {
		if (!content.nodes) return;
		content.nodes.split(/\W+/).filter(Boolean).forEach(function(word) {
			if (word == rootGroup) {
				console.warn("contents contains root group", rootGroup, el.name, contents);
				return;
			}
			if (word == "text") return;
			var group = pkg.groups[word];
			if (group) {
				if (gDone[word]) return;
				gDone[word] = true;
			} else {
				group = [word];
			}
			group.forEach((sub) => {
				listDependencies(pkg, rootGroup, elts[sub], list, gDone, eDone);
			});
		});
	});
	else if (el.name == rootGroup) {
		var group = pkg.groups[el.name];
		if (group) {
			gDone[el.name] = true;
			group.forEach((sub) => {
				listDependencies(pkg, rootGroup, elts[sub], list, gDone, eDone);
			});
		}
	}
	return list;
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

