const Path = require('node:path');
const toSource = require.lazy('tosource');
const { EltProxy, MapProxy } = require('./proxies');

const { promises: fs } = require('node:fs');
const vm = require.lazy('node:vm');
const translateJSON = require.lazy('./translate');
const schemas = require.lazy('./schemas');


/*
An element has these properties:

- name: the type of the block
- group: elements are grouped by content identifiers. An element can contain a group of elements (in the contents specifiers). A bundle contain all elements of all groups that are contained in the root element.
- bundle: if true, indicates that an element is the root of a bundle - in which case that bundle carries its name. If a string, indicates in which bundle an element must be included, this is needed when an element is not part of any content.
- standalone: if true, indicates that all instances of an element are independent in the site. They can have multiple parents, or none (except the site itself). These elements are usually fetched by queries. Those instances won't be garbage-collected.
- standalone block: this is different, it tells that a specific instance of an element can be shared amongst multiple parents. These blocks are usually embedded in the content of a standalone element (e.g. a page). Those blocks can be garbage-collected, if they happen to have no parents for a while.

There are several specific groups:

- text: content-specific, no element is part of the text group
- inline, block: the most common content groups
- page: instances of elements in that group have a data.url,
and can be rendered at that url. In consequence they are eligible to being part
of the site map. Pages are usually also bundles, and the sitemap bundles the elements in the page group too.
*/

module.exports = class Packager {
	constructor(app, Block) {
		this.app = app;
		this.Block = Block;
	}
	async run(site, pkg) {
		const { elements = [], directories = [] } = pkg || {};
		const { Block } = this;
		if (!site) console.warn("no site in packager.run");
		const id = site ? site.id : null;
		Log.imports("installing", id, elements, directories);
		const allDirs = id ? [ ...this.app.directories, ...directories ] : directories;
		const allElts = id ? [ ...this.app.elements, ...elements ] : elements;

		sortPriority(allDirs);
		sortPriority(allElts);

		const bundleMap = pkg.bundleMap = new Map();
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
		const aliases = {};
		const textblocks = new Set();
		const standalones = new Set();
		for (const name of names) {
			const el = { ...elts[name] }; // drop proxy
			el.name = name;
			el.contents = Block.normalizeContentSpec(el.contents);
			if (el.alias) {
				aliases[name] = el.alias;
			} else if (el.standalone && !Object.isEmpty(el.properties) && el.$lock !== true) {
				// e.g. "write", "user", "private"
				standalones.add(name);
			}
			if (!el.expressions && !el.inline && el.contents && el.contents.some(item => {
				return ['inline*', 'text*', 'mail_inline*'].includes(item.nodes);
			})) {
				if (el.inplace) {
					console.warn("element with inline content should not be inplace", el.name);
				} else {
					textblocks.add(name);
				}
			}
			eltsMap[name] = el;
			if (!bundleMap.has(name)) {
				bundleMap.set(name, new Set());
			}
			const bundleSet = bundleMap.get(name);
			if (el.group) el.group.split(/\s+/).forEach(gn => {
				let group = groups[gn];
				if (!group) group = groups[gn] = [];
				if (!group.includes(name)) group.push(name);
			});

			if (el.bundle === true) {
				bundles[name] = {};
			} else if (el.bundle) {
				if (!bundles[el.bundle]) bundles[el.bundle] = {};
				if (!bundles[el.bundle].list) bundles[el.bundle].list = [];
				bundles[el.bundle].list.push(el);
				bundleSet.add(el.bundle);
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
		Object.assign(pkg, {
			eltsMap, groups, aliases, bundles, standalones, textblocks
		});
		if (!pkg.eltsMap.site) pkg.eltsMap.site = schemas.site;
		return Block.initSite(site, pkg);
	}

	async makeBundles(site, pkg) {
		const { eltsMap, bundles } = pkg;
		const standalones = [];
		for (const name of pkg.standalones) {
			standalones.push(pkg.eltsMap[name]);
		}
		site.$pkg.bundleMap = pkg.bundleMap;
		site.$pkg.aliases = pkg.aliases;
		if (eltsMap.write) {
			const writeBundles = await Promise.all([this.#bundleSource(
				site, pkg, null, 'services', this.app.services
			), this.#bundleSource(
				site, pkg, null, 'standalones', standalones
			)]);
			for (const bundle of writeBundles) if (bundle) {
				eltsMap.write.scripts.push(bundle);
			}
		}
		await Promise.all(Object.entries(bundles).map(
			([name, { list }]) => this.#bundle(
				site, pkg, eltsMap[name], list
			)
		));
		// clear up some space
		delete pkg.eltsMap;
		delete pkg.bundles;
		delete pkg.aliases;
	}

	async #bundle(site, pkg, rootEl, cobundles = []) {
		const list = this.#listDependencies(
			pkg, rootEl, rootEl, cobundles.slice()
		);
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
		// for (const el of cobundles) {
		// 	if (el.bundle) {
		// 		if (typeof el.bundle == "string") console.log("cobundle", el.bundle, "name", el.name);
		// 		pkg.eltsMap[el.name].scripts = scripts;
		// 		pkg.eltsMap[el.name].stylesheets = styles;
		// 	}
		// }
		const skipSchemas = metaKeys.length == 1 && rootEl.name == "core";
		const path = skipSchemas ? null : await this.#bundleSource(site, pkg, prefix, 'elements', eltsMap);
		metaEl.bundles = [];
		metaEl.schemas = path ? [path] : [];
		metaEl.scripts = rootEl.bundle === true ? rootEl.scripts : [];
		metaEl.stylesheets = rootEl.bundle === true ? rootEl.stylesheets : [];
		metaEl.resources = rootEl.resources;
		metaEl.priority = rootEl.priority;

		// for (const el of cobundles) {
		// 	if (el.bundle === true) {
		// 		site.$pkg.bundles[el.name] = {
		// 			meta: {
		// 				...el,
		// 				scripts: metaEl.scripts,
		// 				stylesheets: metaEl.stylesheets,
		// 				resources: metaEl.resources,
		// 				schemas: metaEl.schemas
		// 			},
		// 			elements: metaKeys
		// 		};
		// 	}
		// }
	}

	async #bundleSource(site, pkg, prefix, name, obj) {
		if (!site.url || prefix?.startsWith('ext-')) return;
		const tag = site.data.version ?? site.$pkg.tag;
		if (tag == null) return;
		const filename = [prefix, name].filter(Boolean).join('-') + '.js';
		const sourceUrl = `/.files/${tag}/${filename}`;
		const sourcePath = this.app.statics.resolve(site.id, sourceUrl);
		let source = toSource(obj);
		if (!Array.isArray(obj)) {
			source = `Object.assign(Pageboard.${name} || {}, ${source})`;
		}
		const str = `Pageboard.${name} = ${source};`;
		await fs.mkdir(Path.dirname(sourcePath), { recursive: true });
		await fs.writeFile(sourcePath, str);
		const paths = await this.app.statics.bundle(
			site, pkg, [sourceUrl], filename
		);
		return paths[0];
	}

	#listDependencies(
		pkg, root, el,
		list = [],
		gDone = new Set()
	) {
		const bundleSet = pkg.bundleMap.get(el.name);
		if (bundleSet.has(root.name)) {
			return list;
		}
		if (typeof el.bundle == "string" && root.name != el.bundle || el.bundle === true && el.name != root.name) {
			return list;
		}
		const elts = pkg.eltsMap;
		list.push(el);
		// when listing dependencies, do not include elements from other bundles
		// -> other bundles are known
		bundleSet.add(root.name);
		if (el.contents) for (const content of el.contents) {
			if (!content.nodes) continue;
			for (const word of content.nodes.split(/\W+/).filter(Boolean)) {
				if (word == root.group) {
					console.warn("contents contains root group", root.group, el.name);
					continue;
				}
				if (word == "text") continue;
				let group = pkg.groups[word];
				if (group) {
					if (gDone.has(word)) continue;
					gDone.add(word);
				} else {
					group = [word];
				}
				for (const sub of group) {
					this.#listDependencies(pkg, root, elts[sub], list, gDone);
				}
			}
		} else if (el.name == root.group) {
			const group = pkg.groups[el.name];
			if (group) {
				gDone.add(el.name);
				for (const sub of group) {
					this.#listDependencies(pkg, root, elts[sub], list, gDone);
				}
			}
		}
		return list;
	}
};

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
	elements.forEach(el => {
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
						res = res.filter(lurl => {
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
	const mount = directories.find(mount => {
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
