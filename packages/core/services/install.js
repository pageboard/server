const Path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').exec);
const { types: { isProxy } } = require('node:util');
const vm = require('node:vm');
const { promises: fs } = require('node:fs');

const semver = require('semver');
const toSource = require('tosource');

const utils = require('../../../src/utils');
const { createEltProxy, MapProxy } = require('../src/proxies');
const translateJSON = require('../src/translate');

/*
Description of element properties used by installer
---------------------------------------------------
- name: the type of the block
- group: elements are grouped by content identifiers. An element can contain a group of elements (in the contents specifiers). A bundle contain all elements of all groups that are contained in the root element.
- bundle: if true, indicates that an element is the root of a bundle - in which case that bundle carries its name. If a string, indicates in which bundle an element must be included, this is needed when an element is not in any group or content
Parsed elements have their bundle property filled to the resolved bundle.
- standalone: if true, indicates that all instances of an element are independent in the site. They can have multiple parents, or none (except the site itself). These elements are usually fetched by queries. Those instances won't be garbage-collected.
- standalone block: this is different, it tells that a specific instance of an element can be shared amongst multiple parents. These blocks are usually embedded in the content of a standalone element (e.g. a page). Those blocks can be garbage-collected, if they happen to have no parents for a while.

There are several specific groups:

- text: content-specific, no element is part of the text group
- inline, block: the most common content groups
- page: instances of elements in that group have a data.url,
and can be rendered at that url. In consequence they are eligible to being part
of the site map. Pages are usually also bundles, and the sitemap bundles the elements in the page group too.
*/

module.exports = class InstallService {
	static name = 'install';
	static $global = true;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async site(req) {
		const siteDir = this.app.statics.dir(req, 'site');
		const curPkg = await this.#getPkg(Path.join(siteDir, 'current'));
		if (curPkg.version) curPkg.dir = Path.join(siteDir, curPkg.version);
		curPkg.current = true;
		const nextPkg = await this.#install(req);
		await Promise.all(Object.keys(nextPkg.dependencies).map(
			mod => this.#config(req, nextPkg, mod)
		));
		return nextPkg;
	}

	async domain(req, site) {
		const mustWait = site.$url && (site.data.env != "production" || !site.$pkg);
		if (mustWait) this.app.domains.hold(site);
		try {
			req.site = site;
			const pkg = await this.site(req);
			site = await this.pack(req, pkg);
			await req.call('auth.install', site);
			if (!pkg.current) {
				await this.#migrate(req, site);
				await site.$query(req.sql.trx).patchObject({
					type: site.type,
					data: {
						versions: site.data.versions,
						server: site.data.server
					}
				});
			}
			await this.#clean(pkg);
			this.app.domains.release(site);
			await req.call('cache.install', site);
			return site;
		} catch (err) {
			console.error(err);
			if (mustWait) this.app.domains.error(site, err);
			throw err;
		}
	}
	static domain = {
		title: 'domain',
		$action: 'write',
		$private: true
	};

	async #getPkg(pkgDir) {
		const pkgPath = Path.join(pkgDir, 'package.json');
		const obj = await readPkg(pkgPath) ?? {};
		obj.dir = pkgDir;
		obj.path = pkgPath;
		obj.directories ??= [];
		obj.elements ??= [];
		obj.dependencies ??= {};
		return obj;
	}

	async #install(req) {
		const { data } = req.site;
		const siteDir = this.app.statics.dir(req, 'site');
		const { dependencies = {} } = data;
		const version = utils.hash(JSON.stringify(dependencies));

		const pkg = await this.#getPkg(Path.join(siteDir, version));
		pkg.dependencies = {};
		for (const [mod, ver] of Object.entries(dependencies)) {
			pkg.dependencies[mod] = ver.startsWith('link://')
				? 'link://' + Path.resolve(this.app.cwd, ver.substring('link://'.length))
				: ver;
		}
		pkg.name = req.site.id;
		await prepareDir(pkg);
		Log.install(pkg);
		const baseEnv = {
			npm_config_userconfig: ''
		};
		Object.entries(process.env).forEach(([key, val]) => {
			if (
				['HOME', 'PATH', 'LANG', 'SHELL'].includes(key) ||
				key.startsWith('XDG_') || key.startsWith('LC_')
			) {
				baseEnv[key] = val;
			}
		});
		if (process.env.SSH_AUTH_SOCK) {
			// some local setup require to pass this to be able to use ssh keys
			// for git checkouts on private repositories
			baseEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
		}
		const { timeout } = this.opts;
		const args = [
			'install',
			'--no-optional',
			'--prod',
			// '--reporter=silent', // https://github.com/pnpm/pnpm/issues/2738
			'--reporter=append-only'
		];

		const command = `pnpm ${args.join(' ')}`;

		try {
			await exec(command, {
				cwd: pkg.dir,
				env: baseEnv,
				shell: false,
				timeout
			});
			for (const mod of Object.keys(pkg.dependencies)) {
				const modDir = Path.join(pkg.dir, 'node_modules', mod);
				const modPkg = await readPkg(Path.join(modDir, 'package.json'));
				pkg.dependencies[mod] = modPkg.version;
			}
			pkg.version = utils.hash(
				await fs.readFile(Path.join(pkg.dir, "pnpm-lock.yaml"))
			);
			await writePkg(pkg);
		} catch (err) {
			// FIXME after failure, won't process new requests / see domain too
			if (err.signal == "SIGTERM") err.message = "Timeout installing " + req.site.id;
			console.error(command);
			console.error("in", pkg.dir);
			if (err.stderr || err.stdout) {
				throw new Error(err.stderr || err.stdout);
			} else {
				throw err;
			}
		}

		const versionDir = Path.join(siteDir, pkg.version);
		if (pkg.dir != versionDir) {
			await fs.rm(versionDir, { recursive: true, force: true });
			await fs.mv(pkg.dir, versionDir);
			pkg.dir = versionDir;
		}
		data.versions = pkg.dependencies;
		data.server = this.app.version;
		return pkg;
	}

	async #config(site, pkg, mod) {
		const { id } = site;
		const moduleDir = Path.join(pkg.dir, 'node_modules', mod);
		const meta = await this.#getPkg(moduleDir);
		const pbConf = meta.pageboard;
		if (!pbConf) {
			throw new HttpError.BadRequest(`site dependency ${mod} must declare at least package.json#pageboard.version`);
		}
		if (!semver.satisfies(this.app.version, pbConf.version)) {
			throw new HttpError.BadRequest(`Server ${this.app.version} is not compatible with module ${mod} which has support for server ${pbConf.version}`);
		}
		const destUrl = Path.join('/', '@file', 'site', pkg.version, mod);
		let directories = pbConf.directories || [];
		if (!Array.isArray(directories)) directories = [directories];
		Log.install("processing directories from", moduleDir, directories);
		directories.forEach(mount => {
			if (typeof mount == "string") mount = {
				from: mount,
				to: mount
			};
			const from = Path.resolve(moduleDir, mount.from);
			const to = Path.resolve(destUrl, mount.to);
			if (from.startsWith(moduleDir) == false) {
				console.warn(
					`Warning: ${id} dependency ${mod} bad mount from: ${from}`
				);
			} else if (to.startsWith(destUrl) == false) {
				console.warn(
					`Warning: ${id} dependency ${mod} bad mount to: ${to}`
				);
			} else {
				pkg.directories.push({
					from: from,
					to: to,
					priority: pbConf.priority || 0
				});
			}
		});

		let elements = pbConf.elements || [];
		if (!Array.isArray(elements)) elements = [elements];
		Log.install("processing elements from", moduleDir, elements);
		await Promise.all(elements.map(async (path) => {
			const absPath = Path.resolve(moduleDir, path);
			const list = await this.#listDir(id, absPath);
			list.sort((a, b) => {
				a = Path.basename(a, Path.extname(a));
				b = Path.basename(b, Path.extname(b));
				if (a == b) return 0;
				else if (a > b) return 1;
				else if (a < b) return -1;
			}).map(path => Path.join(absPath, path)).forEach(path => {
				if (path.endsWith('.js')) {
					pkg.elements.push({
						path,
						priority: pbConf.priority || 0
					});
				}
			});
		}));
	}

	async #clean(pkg) {
		if (pkg.current || !await utils.exists(pkg.dir)) return; // fail safe
		const parentDir = Path.dirname(pkg.dir);
		const curDir = Path.join(parentDir, 'current');
		await fs.rm(curDir, { force: true });
		await fs.symlink(pkg.version, curDir);

		try {
			const paths = await fs.readdir(parentDir);
			const stats = await Promise.all(paths.map(async item => {
				const path = Path.join(parentDir, item);
				const stat = await fs.stat(path);
				return { stat, path };
			}));
			stats.sort((a, b) => {
				if (a.path == pkg.dir) return -1;
				if (a.stat.mtimeMs > b.stat.mtimeMs) return -1;
				if (a.stat.mtimeMs == b.stat.mtimeMs) return 0;
				if (a.stat.mtimeMs < b.stat.mtimeMs) return 1;
			});
			await Promise.all(stats.slice(3).map(obj => {
				return fs.rm(obj.path, { recursive: true });
			}));
		} catch (err) {
			console.error(err);
		}
		return pkg;
	}

	async #listDir(id, dirPath) {
		try {
			const stat = await fs.stat(dirPath);
			if (stat.isDirectory()) {
				return await fs.readdir(dirPath);
			} else {
				return [dirPath];
			}
		} catch (err) {
			console.warn("In site", id, err);
			return [];
		}
	}

	async #migrate(req, site) {
		const { migrations } = site.$pkg;
		const { versions } = req.site.data;
		// FIXME dependencies might be with link://path
		// what we need here is the installed
		// comparison between current pkg.dependencies and the ones that just got installed
		const oldVersion = semver.minVersion(req.site.data.server);
		for (const [mod, ver] of Object.entries(site.data.versions)) {
			const old = versions ? versions[mod] : oldVersion;
			if (!old || old == ver) continue;
			const migs = semver.sort(Object.keys(migrations).filter(
				mig => {
					mig = semver.coerce(mig);
					return semver.lt(old, mig) && semver.gte(mig, ver);
				}
			));
			console.warn(migs);
			for (const mig of migs) {
				for (const [type, list] of migrations[mig]) {
					for (const unit of list) {
						await this.#migrateUnit(req, type, unit);
					}
				}
			}
		}
	}

	async #migrateUnit({ site, sql: { trx, fun, ref } }, type, unit) {
		const q = site.$relatedQuery('children', trx)
			.where('block.type', type);
		const [op, path, ...params] = unit;
		const Migrations = {
			replace(q, col, from, to) {
				q.patch({
					[col]: fun(
						'replace',
						ref(col).castText(),
						from,
						to
					).castJson()
				});
				q.whereNotNull(col);
			},
			cast(q, col, to) {
				const refTo = {
					float: fun('regexp_replace', ref(col).castText(), '([0-9.]*).*', '\\1').castTo('jsonb')
				}[to];
				if (!to) {
					throw new HttpError.BadRequest(`Unknown type to cast to: ${to}`);
				}
				q.update({
					[col]: refTo
				});
				q.whereNotNull(col);
			},
			patch(q, col, from, to) {
				q.update({
					[col]: to
				});
				q.where(col, from);
			}
		};
		const unitFn = Migrations[op];
		if (!unitFn) {
			throw new HttpError.BadRequest(`Unknown migration operation: ${op} for type ${type}`);
		}
		unitFn(q, `data:${path}`, ...params);
		return q;
	}

	async pack(req, pkg = {}) {
		const { site } = req;
		const { elements = [], directories = [] } = pkg;
		Log.imports("installing", site.id, elements, directories);
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
		const context = {};
		for (const eltObj of elements) {
			const { path } = eltObj;
			const buf = await fs.readFile(path);
			context.mount = getMountPath(path, directories);
			context.path = path;
			loadFromFile(buf, elts, names, context);
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
						// FIXME
						polyfills.add(p);
					}
				}
				delete el.polyfills;
			}
			el.contents = req.sql.Block.normalizeContentSpec(el.contents);
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
				return item.nodes == null && item.id || ['inline*', 'text*', 'mail_inline*'].includes(item.nodes);
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
				// TODO schemas can have translatable strings,
				// but they need to be stored in some block's content fields,
				// instead of hard-coded in an immutable schema bundle.
				// Another type of content should be built to hold schema strings
				// schema: { data: /* the schema */}
				// content: { jspath to data fields: "translatable content" }
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
		// mount paths
		await req.call('statics.install', pkg);
		// build js, css, and compile schema validators
		const ret = req.sql.Block.initSite(site, pkg);
		await this.#makeSchemas(ret, pkg);
		await this.#makeBundles(ret, pkg);
		return ret;
	}
	static pack = {
		title: 'pack',
		$action: 'write',
		$private: true
	};

	async #makeSchemas(site, pkg) {
		const mclass = site.$modelClass;
		const validator = mclass.getValidator();
		await validator.prepare(mclass, pkg);
	}

	async #makeBundles(site, pkg) {
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
		if (site.id == "*" || prefix?.startsWith('ext-')) return;
		const { version } = site.$pkg;
		const filename = [prefix, assign, name].filter(Boolean).join('-') + '.js';
		const sourceUrl = `/@file/site/${version}/${filename}`;
		const sourcePath = this.app.statics.path(
			{ site },
			sourceUrl
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

async function prepareDir(pkg) {
	await fs.mkdir(pkg.dir, {
		recursive: true
	});
	return writePkg(pkg);
}

async function writePkg(pkg) {
	await fs.writeFile(pkg.path, JSON.stringify({
		"private": true,
		name: pkg.name,
		dependencies: pkg.dependencies,
		version: pkg.version
	}, null, ' '));
	return pkg;
}

async function readPkg(path) {
	try {
		const buf = await fs.readFile(path);
		return JSON.parse(buf);
	} catch {
		return {};
	}
}


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

function getMountPath(eltPath, directories) {
	const mount = directories.find(mount => {
		return eltPath.startsWith(mount.from);
	});
	if (!mount) return;
	const eltPathname = Path.join(mount.to, eltPath.substring(mount.from.length));
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
		names.push(name);
		if (!isProxy(elt)) {
			context.name = name;
			Object.defineProperty(elts, name, {
				value: createEltProxy(elt, context),
				writable: false,
				enumerable: false,
				configurable: false
			});
		}
	}
}
