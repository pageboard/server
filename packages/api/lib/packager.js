const Path = require('node:path');
const toSource = require.lazy('tosource');
const { EltProxy, MapProxy } = require('./proxies');

const fs = require('node:fs/promises');
const { types: { isProxy } } = require('node:util');
const vm = require.lazy('node:vm');
const translateJSON = require.lazy('./translate');

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
	async run(site, pkg = {}) {
		const { elements = [], directories = [] } = pkg;
		const { Block } = this;
		if (!site) console.warn("no site in packager.run");
		const id = site ? site.id : null;
		Log.imports("installing", id, elements, directories);
		const subSort = function (a, b) {
			if (a.path && b.path) {
				return Path.basename(a.path).localeCompare(Path.basename(b.path));
			} else {
				return 0;
			}
		};
		sortPriority(directories, subSort);
		sortPriority(elements, subSort);

		const bundleMap = pkg.bundleMap = new Map();
		const elts = structuredClone(this.app.elements);
		const names = Object.keys(elts);
		for (const eltObj of elements) {
			const { path } = eltObj;
			const buf = await fs.readFile(path);
			const mount = getMountPath(path, id, directories);
			loadFromFile(buf, elts, names, { mount, path });
		}
		const eltsMap = {};
		const groups = {};
		const bundles = {};
		const aliases = {};
		const textblocks = new Set();
		const hashtargets = new Set();
		const standalones = new Set();
		const polyfills = new Set();
		for (const name of names) {
			const el = { ...elts[name] }; // drop proxy
			el.name = name;
			if (el.polyfills) {
				for (const p of el.polyfills) {
					if (p.includes('[$lang]')) {
						const langs = site.data.languages ?? [site.data.lang];
						for (const lang of langs) {
							polyfills.add(p.replace('[$lang]', lang));
						}
					} else {
						polyfills.add(p);
					}
				}
				delete el.polyfills;
			}
			el.contents = Block.normalizeContentSpec(el.contents);
			if (!el.contents) delete el.contents;
			if (el.alias) {
				aliases[name] = el.alias;
			} else if (el.standalone && !el.virtual) {
				standalones.add(name);
			}
			if (el.properties?.id?.format == "grant") {
				// we have a linkable ref
				hashtargets.add(name);
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
				bundles[el.bundle].add(name);
				rootList.add(el.bundle);
			}
			if (el.intl) {
				const lang = site.data.languages?.[0];
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
			eltsMap, groups, aliases, bundles,
			standalones, textblocks, hashtargets, polyfills
		});
		return Block.initSite(site, pkg);
	}

	async makeSchemas(site, pkg) {
		const mclass = site.$modelClass;
		const validator = mclass.getValidator();
		await validator.prepare(mclass, pkg);
	}

	async makeBundles(site, pkg) {
		const { $pkg } = site;
		$pkg.aliases = pkg.aliases;
		const { eltsMap } = pkg;

		const { actions, reads, writes } = this.app.api.validation;

		$pkg.bundles.set('services', {
			scripts: [
				await this.#bundleSource(site, {
					assign: 'schemas',
					name: 'services',
					source: actions
				}),
				await this.#bundleSource(site, {
					assign: 'schemas',
					name: 'reads',
					source: reads
				}), await this.#bundleSource(site, {
					assign: 'schemas',
					name: 'writes',
					source: writes
				})
			]
		});

		const bundles = Object.entries(pkg.bundles).sort(([na], [nb]) => {
			// bundle page group before others
			const a = eltsMap[na];
			const b = eltsMap[nb];
			if (a.group == "page" && b.group != "page") return -1;
			else if (b.group == "page" && a.group != "page") return 1;
			else return 0;
		});

		// incorporate polyfills/elements into core scripts
		if (eltsMap.core) eltsMap.core.scripts.unshift(
			await this.#bundleSource(site, {
				name: 'polyfills', dry: true
			}),
			await this.#bundleSource(site, {
				assign: 'schemas',
				name: 'elements', dry: true
			})
		);

		// prepare bundles output paths
		for (const [name, list] of bundles) {
			// rootEl is a copy of eltsMap[name] with the original scripts
			const bundleEl = this.#bundle(pkg, name, list);
			$pkg.bundles.set(name, bundleEl);
			bundleEl.scripts = await this.app.statics.bundle(site, {
				inputs: bundleEl.scripts ?? [],
				output: `${name}.js`,
				dry: true
			});
			bundleEl.stylesheets = await this.app.statics.bundle(site, {
				inputs: bundleEl.stylesheets ?? [],
				output: `${name}.css`,
				dry: true
			});
		}

		// concatenate bundles dependencies
		for (const [name, bundleEl] of $pkg.bundles) {
			const dependencies = (bundleEl.dependencies ?? [])
				.concat([name]).map(n => $pkg.bundles.get(n) ?? n);
			sortPriority(dependencies);
			const scripts = [];
			const stylesheets = [];
			const resources = {};
			for (const bundle of dependencies) {
				if (typeof bundle == "string") {
					console.warn("Missing dependency", bundle);
					continue;
				}
				if (bundle.scripts) scripts.push(...bundle.scripts);
				if (bundle.stylesheets) stylesheets.push(...bundle.stylesheets);
				if (bundle.resources) Object.assign(resources, bundle.resources);
			}
			bundleEl.scripts = Array.from(new Set(scripts));
			bundleEl.stylesheets = Array.from(new Set(stylesheets));
			const el = eltsMap[name];
			if (el) {
				bundleEl.orig = { scripts: el.scripts, stylesheets: el.stylesheets };
				el.scripts = bundleEl.scripts;
				el.stylesheets = bundleEl.stylesheets;
				delete el.dependencies;
			}
		}

		// strip elements
		for (const el of Object.values(eltsMap)) {
			if (el.migrations) {
				for (const [key, list] of Object.entries(el.migrations)) {
					$pkg.migrations[key] ??= {};
					$pkg.migrations[key][el.name] = list;
				}
				delete el.migrations;
			}
			if ($pkg.bundles.has(el.name)) continue;
			delete el.scripts;
			delete el.stylesheets;
			delete el.bundle;
			if (Object.isEmpty(el.resources)) delete el.resources;
		}

		// create those files
		await this.#bundleSource(site, {
			name: 'polyfills',
			source: await this.app.polyfill.source(Array.from(pkg.polyfills))
		});
		await this.#bundleSource(site, {
			assign: 'schemas',
			name: 'elements',
			source: {
				$id: '/elements',
				definitions: pkg.eltsMap,
				discriminator: {
					propertyName: 'type'
				},
				oneOf: Object.keys(pkg.eltsMap).map(key => {
					return { $ref: '#/definitions/' + key };
				})
			}
		});

		// create bundles
		for (const [name, bundleEl] of $pkg.bundles) {
			if (!bundleEl.orig) continue;
			await Promise.all([
				this.app.statics.bundle(site, {
					inputs: bundleEl.orig?.scripts ?? [],
					output: `${name}.js`
				}),
				this.app.statics.bundle(site, {
					inputs: bundleEl.orig?.stylesheets ?? [],
					output: `${name}.css`
				})
			]);
			delete bundleEl.orig;
		}

		// clear up some space
		delete pkg.polyfills;
		delete pkg.eltsMap;
		delete pkg.bundleMap;
		delete pkg.bundles;
		delete pkg.aliases;
	}

	#bundle(pkg, root, cobundles = new Set()) {
		const { eltsMap } = pkg;
		const el = eltsMap[root];

		const bundle = Array.from(this.#listDependencies(
			pkg, el, el, new Set(cobundles)
		));
		const list = bundle.map(n => eltsMap[n]);
		sortPriority(list, (a, b) => {
			if (a.name && b.name) return a.name.localeCompare(b.name);
			else return 0;
		});
		el.scripts = sortElements(list, 'scripts');
		el.stylesheets = sortElements(list, 'stylesheets');
		el.resources = { ...el.resources };
		el.bundle = bundle;
		return { ...el };
	}

	async #bundleSource(site, { prefix, assign, name, source, dry }) {
		if (prefix?.startsWith('ext-')) return;
		const { version } = site.$pkg;
		const filename = [prefix, assign, name].filter(Boolean).join('-') + '.js';
		const sourceUrl = `/@site/${version}/${filename}`;
		const sourcePath = this.app.statics.urlToPath(
			{ site },
			`/@site/${version}/${filename}`
		);
		if (source) {
			if (typeof source == "object") {
				source = toSource(source);
			}
			if (assign) assign = "." + assign;
			else assign = "";
			source = `window.Pageboard${assign}.${name} = ${source};`;
		} else if (!dry) {
			throw new Error("Missing source argument");
		}

		if (!dry) {
			await fs.mkdir(Path.dirname(sourcePath), { recursive: true });
			if (assign) assign = `window.Pageboard${assign} ??= {};`;
			await fs.writeFile(sourcePath, `window.Pageboard ??= {}; ${assign} ${source}`);
		}
		const paths = await this.app.statics.bundle(site, {
			inputs: [sourceUrl],
			output: filename,
			dry
		});
		return paths[0];
	}

	#listDependencies(
		pkg, root, el,
		list,
		gDone = new Set()
	) {
		const bundleSet = pkg.bundleMap.get(el.name);
		// elements from other non-page bundles are not included
		if (
			list.has(el.name) && el.bundle != root.name
			||
			root.group != "page" && bundleSet.size > 0 && !bundleSet.has(root.name)
			||
			el.bundle === true && el.name != root.name
			||
			typeof el.bundle == "string" && el.bundle != root.name
		) {
			return list;
		}

		bundleSet.add(root.name);
		const elts = pkg.eltsMap;
		list.add(el.name);

		if (el.contents) for (const content of el.contents) {
			if (!content.nodes) continue;
			for (const word of content.nodes.split(/\W+/).filter(Boolean)) {
				if (word == root.group || word == "text") {
					continue;
				}
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
			const group = pkg.groups[root.group];
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

function sortPriority(list, subSort) {
	list.sort((a, b) => {
		const pa = a.priority || 0;
		const pb = b.priority || 0;
		if (pa == pb) {
			if (subSort) return subSort(a, b);
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
	script.runInNewContext(sandbox, {
		filename: context.path,
		timeout: 1000
	});

	for (const [name, elt] of Object.entries(elts)) {
		if (isProxy(elt)) continue;
		elt.name = name;
		elt.scripts ??= [];
		elt.stylesheets ??= [];
		elt.resources ??= {};
		elt.polyfills ??= [];
		elt.fragments ??= [];
		elt.resources ??= {};
		elt.properties ??= {};
		elt.csp ??= {};
		elt.filters ??= {};
		names.push(name);
		Object.defineProperty(elts, name, {
			value: new Proxy(elt, new EltProxy(name, context)),
			writable: false,
			enumerable: false,
			configurable: false
		});
	}
}
