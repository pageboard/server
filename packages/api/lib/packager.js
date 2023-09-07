const Path = require('node:path');
const toSource = require.lazy('tosource');
const { EltProxy, MapProxy } = require('./proxies');

const fs = require('node:fs/promises');
const vm = require.lazy('node:vm');
const translateJSON = require.lazy('./translate');
const { mergeRecursive } = require('../../../src/utils');


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
		const elts = Object.assign({}, this.app.api.schemas);
		const names = Object.keys(this.app.api.schemas);
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
			if (!el.contents) delete el.contents;
			if (el.alias) {
				aliases[name] = el.alias;
			} else if (el.standalone && !el.virtual) {
				standalones.add(name);
			}
			if (!el.expressions && (!el.inline || !el.inplace) && el.contents && el.contents.some(item => {
				return ['inline*', 'text*', 'mail_inline*'].includes(item.nodes);
			})) {
				textblocks.add(name);
			}
			eltsMap[name] = el;
			let rootList = bundleMap.get(name);
			if (!rootList) {
				bundleMap.set(name, rootList = new Set());
			}
			if (el.group) el.group.split(/\s+/).forEach(gn => {
				const group = groups[gn] ??= new Set();
				group.add(name);
			});

			if (el.bundle === true) {
				bundles[name] ??= new Set();
			} else if (el.bundle) {
				bundles[el.bundle] ??= new Set();
				bundles[el.bundle].add(el.name);
				rootList.add(el.bundle);
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
		return Block.initSite(site, pkg);
	}

	async makeSchemas(site, pkg) {
		const mclass = site.$modelClass;
		const validator = mclass.getValidator();
		await validator.prepare(mclass.jsonSchema, pkg);
	}

	async makeBundles(site, pkg) {
		const { $pkg } = site;
		$pkg.aliases = pkg.aliases;

		await Promise.all(Object.entries(pkg.bundles).sort((a, b) => {
			// bundle page group before others
			if (a.group == "page" && b.group != "page") return -1;
			else if (b.group == "page" && a.group != "page") return 1;
			else return 0;
		}).map(
			([name, list]) => this.#bundle(
				site, pkg, name, list
			)
		));
		// just set the path to elements bundle
		$pkg.bundles.set('elements', {
			priority: -999,
			scripts: [
				await this.#bundleSource(site, pkg, null, 'elements', pkg.eltsMap, true)
			]
		});
		const services = Object.fromEntries(
			Object.entries(this.app.services).map(([key, group]) => {
				const entries = Object.entries(group)
					.filter(([, service]) => service.$lock !== true);
				if (entries.length) return [key, Object.fromEntries(entries)];
			}).filter(x => Boolean(x))
		);

		$pkg.bundles.set('services', {
			scripts: [await this.#bundleSource(
				site, pkg, null, 'services', services
			)]
		});

		for (const [, rootEl] of $pkg.bundles) {
			const dependencies = (rootEl.dependencies ?? [])
				.map(name => {
					const b = $pkg.bundles.get(name);
					if (!b) console.error("Missing bundle", name);
					return b;
				});
			dependencies.push(rootEl);
			sortPriority(dependencies);
			const scripts = [];
			const stylesheets = [];
			const resources = {};
			for (const bundle of dependencies) {
				if (!bundle) continue;
				if (bundle.scripts) scripts.push(...bundle.scripts);
				if (bundle.stylesheets) stylesheets.push(...bundle.stylesheets);
				if (bundle.resources) Object.assign(resources, bundle.resources);
			}
			rootEl.scripts = scripts;
			rootEl.stylesheets = stylesheets;
			rootEl.resources = resources;
			delete rootEl.dependencies;
		}

		// actually build elements bundle
		await this.#bundleSource(site, pkg, null, 'elements', pkg.eltsMap);

		// clear up some space
		delete pkg.eltsMap;
		delete pkg.bundleMap;
		delete pkg.bundles;
		delete pkg.aliases;
	}

	async #bundle(site, pkg, root, cobundles = new Set()) {
		const { eltsMap } = pkg;
		const rootEl = eltsMap[root];

		const list = Array.from(this.#listDependencies(
			pkg, rootEl, rootEl, new Set(cobundles)
		)).map(n => eltsMap[n]);
		list.sort((a, b) => {
			return (a.priority || 0) - (b.priority || 0);
		});
		const scriptsList = sortElements(list, 'scripts');
		const stylesList = sortElements(list, 'stylesheets');

		const bundleElts = {};
		const bundle = [];
		for (const el of list) {
			const copy = { ...el };
			if (!el.standalone) {
				delete copy.scripts;
				delete copy.stylesheets;
				delete copy.resources;
			}
			bundle.push(el.name);
			bundleElts[el.name] = copy;
			if (typeof el.bundle == "string") delete el.bundle;
		}

		const [scripts, styles] = await Promise.all([
			this.app.statics.bundle(site, pkg, scriptsList, `${root}.js`),
			this.app.statics.bundle(site, pkg, stylesList, `${root}.css`)
		]);
		// this removes proxies
		rootEl.scripts = scripts;
		rootEl.stylesheets = styles;
		rootEl.resources = { ...rootEl.resources };
		rootEl.bundle = bundle;
		site.$pkg.bundles.set(root, rootEl);

		return bundleElts;
	}

	async #bundleSource(site, pkg, prefix, name, obj, dry = false) {
		if (prefix?.startsWith('ext-')) return;
		const tag = site.data.version ?? site.$pkg.tag;
		if (tag == null) {
			console.error("Cannot do a bundle without version/tag", site.id);
			return;
		}
		const filename = [prefix, name].filter(Boolean).join('-') + '.js';
		const sourceUrl = `/.files/${tag}/${filename}`;
		const sourcePath = this.app.statics.resolve(site.id, sourceUrl);
		let source = toSource(obj);
		if (!Array.isArray(obj)) {
			source = `Object.assign(window.Pageboard.${name} || {}, ${source})`;
		}
		const str = `window.Pageboard.${name} = ${source};`;
		if (!dry) {
			await fs.mkdir(Path.dirname(sourcePath), { recursive: true });
			await fs.writeFile(sourcePath, str);
		}
		const paths = await this.app.statics.bundle(
			site, pkg, [sourceUrl], filename, dry
		);
		return paths[0];
	}

	#listDependencies(
		pkg, root, el,
		list = [],
		gDone = new Set()
	) {
		const bundleSet = pkg.bundleMap.get(el.name);
		// elements from other non-page bundles are not included
		if (bundleSet.has(root.name) || root.group != "page" && bundleSet.size > 0 || el.bundle === true && el.name != root.name || typeof el.bundle == "string" && root.name != el.bundle) {
			return list;
		}
		bundleSet.add(root.name);
		const elts = pkg.eltsMap;
		list.add(el.name);
		// when listing dependencies, do not include elements from other bundles
		// -> other bundles are known

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
			const group = pkg.groups.get(el.name);
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
	for (const el of elements) {
		let list = el[prop];
		if (!list) continue;
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
	}
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
		elt.scripts = elt.scripts || [];
		elt.stylesheets = elt.stylesheets || [];
		elt.resources = elt.resources || {};
	}
}
