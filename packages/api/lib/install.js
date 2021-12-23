const Path = require('path');
const toSource = require('tosource');
const { AbsoluteProxy, EltProxy, MapProxy } = require('./proxies');

const fs = require('fs').promises;
const vm = require('vm');
const translateJSON = require('./translate');

exports.install = function(site, pkg, All) {
	const elements = pkg.elements;
	const directories = pkg.directories;
	const id = site ? site.id : null;
	Log.imports("installing", id, elements, directories);
	const allDirs = id ? All.opt.directories.concat(directories) : directories;
	const allElts = id ? All.opt.elements.concat(elements) : elements;

	sortPriority(allDirs);
	sortPriority(allElts);

	return Promise.all(allElts.map((eltObj) => {
		return fs.readFile(eltObj.path);
	})).then((bufs) => {
		const elts = {};
		const names = [];
		const context = {};
		bufs.forEach((buf, i) => {
			const path = allElts[i].path;
			context.mount = getMountPath(path, id, allDirs);
			context.path = path;
			loadFromFile(buf, elts, names, context);
		});

		const eltsMap = {};
		const groups = {};
		const bundles = {};

		names.forEach((name) => {
			const el = elts[name] = Object.assign({}, elts[name]); // drop proxy
			el.name = name;
			// backward compatibility with 0.7 extensions names, dropped in favor of output
			if (updateExtension(el, eltsMap)) return;
			eltsMap[name] = el;
			let isPage = false; // backward compatibility with < client@0.7
			if (el.group) el.group.split(/\s+/).forEach((gn) => {
				if (gn == "page") isPage = true;
				let group = groups[gn];
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
			if (el.intl) {
				const { lang } = site.data;
				if (lang) {
					const i8dict = el.intl[lang];
					const i8keys = el.intl.keys;
					if (i8dict) {
						if (i8keys) {
							translateJSON(i8keys, el, i8dict);
						} else {
							console.warn(
								`${el.name}.intl.${lang} is set but the list intl.keys is missing`
							);
						}
					}
				}
				delete el.intl;
			}
		});

		const Block = All.api.Block.extendSchema(id, eltsMap);
		if (id) {
			pkg.Block = Block;
			pkg.eltsMap = eltsMap;
			pkg.groups = groups;
			site.$pages = groups.page;
			site.$bundles = {};
			site.constructor = Block;
		} else {
			All.api.Block = Block;
		}
		return bundles;
	}).catch((err) => {
		console.error(err);
		throw err;
	});
};

function updateExtension(el, eltsMap) {
	const extPage = {
		'.mail': 'mail'
	}[el.name];
	if (!extPage) return;
	const page = eltsMap[extPage];
	page.scripts = (page.scripts || []).concat(el.scripts);
	if (el.prerender) page.output = el.prerender;
	if (el.print) page.output = Object.assign({}, page.output, {pdf: true});
	return true;
}

exports.validate = function(site, pkg, bundles) {
	const eltsMap = pkg.eltsMap;
	return Promise.all(Object.entries(bundles).map(([name, {list}]) => {
		const el = eltsMap[name];
		return bundle(site, pkg, el, list);
	})).then(() => {
		return bundleSource(site, pkg, null, 'services', All.services).then((path) => {
			site.$services = path;
		});
	}).then(() => {
		site.$scripts = pkg.eltsMap.site.scripts;
		site.$resources = pkg.eltsMap.site.resources;
		site.$stylesheets = pkg.eltsMap.site.stylesheets;
		delete pkg.eltsMap;
		delete pkg.Block;
	});
};

function sortPriority(list) {
	list.sort((a, b) => {
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

function bundle(site, pkg, rootEl, cobundles = []) {
	const list = listDependencies(pkg, rootEl.group, rootEl, cobundles.slice());
	list.sort((a, b) => {
		return (a.priority || 0) - (b.priority || 0);
	});
	const scripts = sortElements(list, 'scripts');
	const styles = sortElements(list, 'stylesheets');
	const prefix = rootEl.name;

	const eltsMap = {};
	list.forEach((el) => {
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
	]).then(([scripts, styles]) => {
		rootEl.scripts = scripts;
		rootEl.stylesheets = styles;
		cobundles.forEach((el) => {
			if (el.group == "page") {
				pkg.eltsMap[el.name].scripts = scripts;
				pkg.eltsMap[el.name].stylesheets = styles;
			}
		});

		return bundleSource(site, pkg, prefix, 'elements', eltsMap).then((path) => {
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
	return fs.writeFile(sourcePath, str).then(() => {
		return All.statics.bundle(site, pkg, [sourceUrl], filename);
	}).then((paths) => {
		return paths[0];
	});
}

function listDependencies(pkg, rootGroup, el, list = [], gDone = {}, eDone = {}) {
	if (!el || eDone[el.name]) return list;
	const elts = pkg.eltsMap;
	list.push(el);
	eDone[el.name] = true;
	const contents = All.api.Block.normalizeContents(el.contents);
	if (contents) contents.forEach((content) => {
		if (!content.nodes) return;
		content.nodes.split(/\W+/).filter(Boolean).forEach((word) => {
			if (word == rootGroup) {
				console.warn("contents contains root group", rootGroup, el.name, contents);
				return;
			}
			if (word == "text") return;
			let group = pkg.groups[word];
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
		const group = pkg.groups[el.name];
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
	const map = {};
	let res = [];
	elements.forEach((el) => {
		let list = el[prop];
		if (!list) return;
		if (typeof list == "string") list = [list];
		for (let i = 0; i < list.length; i++) {
			const url = list[i];
			const prev = map[url];
			if (prev) {
				if (el.priority != null) {
					if (prev.priority == null) {
						// move prev url on top of res
						res = res.filter((lurl) => {
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
	const mount = directories.find((mount) => {
		return eltPath.startsWith(mount.from);
	});
	if (!mount) return;
	const basePath = id ? mount.to.replace(id + "/", "") : mount.to;
	const eltPathname = Path.join(basePath, eltPath.substring(mount.from.length));
	return Path.dirname(eltPathname);
}

function loadFromFile(buf, elts, names, context) {
	const script = new vm.Script(buf, {
		filename: context.path
	});
	const sandbox = {
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
	for (const name in elts) {
		let elt = elts[name];
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
