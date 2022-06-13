const Path = require('path');
const toSource = require.lazy('tosource');
const { AbsoluteProxy, EltProxy, MapProxy } = require('./proxies');

const { promises: fs } = require('fs');
const vm = require.lazy('vm');
const translateJSON = require.lazy('./translate');
const schemas = require.lazy('./schemas');

module.exports = class Packager {
	constructor(app, Block) {
		this.app = app;
		this.Block = Block;
	}
	async run(site, pkg) {
		const { elements = [], directories = [] } = pkg || {};
		const id = site ? site.id : null;
		Log.imports("installing", id, elements, directories);
		const allDirs = id ? [ ...this.app.directories, ...directories ] : directories;
		const allElts = id ? [ ...this.app.elements, ...elements ] : elements;

		sortPriority(allDirs);
		sortPriority(allElts);

		const elts = {};
		const names = [];
		const context = {};
		for (const eltObj of allElts) {
			const { path } = eltObj;
			const buf = await fs.readFile(path);
			const mount = getMountPath(path, id, allDirs);
			Object.assign(context, { mount, path });
			loadFromFile(buf, elts, names, context);
		}
		const eltsMap = {};
		const groups = {};
		const bundles = {};
		for (const name of names) {
			const el = { ...elts[name] }; // drop proxy
			el.name = name;
			// backward compatibility with 0.7 extensions names, dropped in favor of output
			if (updateExtension(el, eltsMap)) continue;
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
		}


		pkg.eltsMap = eltsMap;
		if (!pkg.eltsMap.site) pkg.eltsMap.site = schemas.site;
		pkg.groups = groups;
		pkg.bundles = bundles;
		return this.Block.initSite(site, pkg);
	}

	async finishInstall(site, pkg) {
		const { eltsMap, bundles } = pkg;
		await Promise.all(Object.entries(bundles).map(
			([name, { list }]) => this.#bundle(site, pkg, eltsMap[name], list)
		));
		site.$pkg.services = await this.#bundleSource(
			site, pkg, null, 'services', this.app.services
		);
		// clear up some space
		delete pkg.eltsMap;
		delete pkg.bundles;
	}

	async #bundle(site, pkg, rootEl, cobundles = []) {
		const list = this.#listDependencies(pkg, rootEl.group, rootEl, cobundles.slice());
		list.sort((a, b) => {
			return (a.priority || 0) - (b.priority || 0);
		});
		const scriptsList = sortElements(list, 'scripts');
		const stylesList = sortElements(list, 'stylesheets');
		const prefix = rootEl.name;

		const eltsMap = {};
		list.forEach(el => {
			if (!el.standalone) {
				el = { ...el };
				delete el.scripts;
				delete el.stylesheets;
			}
			eltsMap[el.name] = el;
		});
		const metaEl = { ...rootEl };
		const metaKeys = Object.keys(eltsMap);
		site.$pkg.bundles[rootEl.name] = {
			meta: metaEl,
			elements: metaKeys
		};

		const [scripts, styles] = await Promise.all([
			this.app.statics.bundle(site, pkg, scriptsList, `${prefix}.js`),
			this.app.statics.bundle(site, pkg, stylesList, `${prefix}.css`)
		]);
		rootEl.scripts = scripts;
		rootEl.stylesheets = styles;
		for (const el of cobundles) {
			if (el.group == "page") {
				pkg.eltsMap[el.name].scripts = scripts;
				pkg.eltsMap[el.name].stylesheets = styles;
			}
		}
		const path = await this.#bundleSource(site, pkg, prefix, 'elements', eltsMap);
		if (path) metaEl.bundle = path;
		metaEl.scripts = rootEl.group != "page" ? rootEl.scripts : [];
		metaEl.stylesheets = rootEl.group != "page" ? rootEl.stylesheets : [];
		metaEl.resources = rootEl.resources;

		for (const el of cobundles) {
			if (el.group == "page") {
				site.$pkg.bundles[el.name] = {
					meta: {
						...el,
						scripts: metaEl.scripts,
						stylesheets: metaEl.stylesheets,
						resources: metaEl.resources,
						bundle: metaEl.bundle
					},
					elements: metaKeys
				};
			}
		}
	}

	async #bundleSource(site, pkg, prefix, name, obj) {
		if (prefix && prefix.startsWith('ext-')) return;
		const filename = [prefix, name].filter(Boolean).join('-') + '.js';
		const tag = site.data.version ?? site.$pkg.tag;
		if (tag != null) {
			const sourceUrl = `/.files/${tag}/${filename}`;
			const sourcePath = this.app.statics.resolve(site.id, sourceUrl);
			const str = `Pageboard.${name} = Object.assign(Pageboard.${name} || {}, ${toSource(obj)});`;
			await fs.writeFile(sourcePath, str);
			const paths = await this.app.statics.bundle(site, pkg, [sourceUrl], filename);
			return paths[0];
		}
	}

	#listDependencies(pkg, rootGroup, el, list = [], gDone = {}, eDone = {}) {
		if (!el || eDone[el.name]) return list;
		const elts = pkg.eltsMap;
		list.push(el);
		eDone[el.name] = true;
		const contents = this.Block.normalizeContents(el.contents);
		if (contents) for (const content of contents) {
			if (!content.nodes) continue;
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
				for (const sub of group) {
					this.#listDependencies(pkg, rootGroup, elts[sub], list, gDone, eDone);
				}
			});
		}	else if (el.name == rootGroup) {
			const group = pkg.groups[el.name];
			if (group) {
				gDone[el.name] = true;
				for (const sub of group) {
					this.#listDependencies(pkg, rootGroup, elts[sub], list, gDone, eDone);
				}
			}
		}
		return list;
	}
};


function updateExtension(el, eltsMap) {
	const extPage = {
		'.mail': 'mail'
	}[el.name];
	if (!extPage) return;
	const page = eltsMap[extPage];
	page.scripts = [ ...page.scripts, ...el.scripts];
	if (el.prerender) page.output = el.prerender;
	if (el.print) page.output = { ...page.output, pdf: true };
	return true;
}

function sortPriority(list) {
	list.sort((a, b) => {
		const pa = a.priority || 0;
		const pb = b.priority || 0;
		if (pa == pb) {
			if (a.path && b.path) return Path.basename(a.path).localeCompare(Path.basename(b.path));
			else return 0;
		}
		if (pa < pb) return -1;
		else return 1;
	});
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
