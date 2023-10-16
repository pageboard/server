const jsonPath = require.lazy('@kapouer/path');

module.exports = class PageService {
	static name = 'page';

	apiRoutes(app, server) {
		server.get('/.api/page', async (req, res) => {
			const { site, query } = req;
			const { url, lang, ext } = req.call('page.parse', query);
			const isWebmaster = !req.locked(['webmaster']) && query.url == url;
			const forWebmaster = Boolean(query.nested);
			delete query.nested;

			const obj = {};
			if (isWebmaster && !forWebmaster) {
				obj.item = {
					type: 'write',
					data: {},
					content: {}
				};
				obj.parent = site;
			} else {
				Object.assign(obj, await req.run('page.get', {
					url, lang, type: ext
				}));
			}
			obj.commons = app.opts.commons;
			res.return(obj);
		});
		server.get('/.api/pages', async (req, res) => {
			const { query, site } = req;
			const isWebmaster = !req.locked(['webmaster']);
			if (isWebmaster) {
				// webmaster want to see those anyway
				// this must not be confused with page.lock
				query.drafts = true;
				if (!query.type) {
					query.type = Array.from(site.$pkg.pages);
				}
			} else if (!query.type) {
				query.type = ['page'];
			}

			const action = query.text != null ? 'page.search' : 'page.list';
			const obj = await req.run(action, query);
			res.return(obj);
		});
		server.post('/.api/page', app.cache.tag('data-:site'), app.auth.lock('webmaster'), async (req, res) => {
			const page = await req.run('page.add', req.body);
			// FIXME use res.return ?
			res.send(page);
		});
		server.put('/.api/page', app.cache.tag('data-:site'), app.auth.lock('webmaster'), async (req, res) => {
			const page = await req.run('page.save', req.body);
			res.send(page);
		});
		server.delete('/.api/page', app.cache.tag('data-:site'), app.auth.lock('webmaster'), async (req, res) => {
			const page = await req.run('page.del', req.query);
			res.send(page);
		});
	}

	#QueryPage({ site, trx, ref, val, fun }, { url, lang, type }) {
		return site.$relatedQuery('children', trx)
			.columns({
				lang,
				content: true
			})
			.first()
			// eager load children (in which there are standalones)
			// and children of standalones
			.withGraphFetched(`[
				children(childrenFilter) as children,
				children(standalonesFilter) as standalones .children(childrenFilter)
			]`).modifiers({
				childrenFilter(q) {
					q.columns({ lang, content: true })
						.where('block.standalone', false)
						.whereNot('block.type', 'content');
				},
				standalonesFilter(q) {
					q.columns({ lang, content: true })
						.where('block.standalone', true)
						.whereNot('block.type', 'content');
				}
			})
			.where(q => {
				q.whereJsonText("block.data:url", url);
				q.where(fun.coalesce(ref("block.data:prefix").castBool(), false), false);
				q.orWhere(
					// matching pages have url ending with /
					fun('starts_with', val(url), ref('block.data:url').castText())
				);
				q.where(ref("block.data:prefix").castBool(), true);
			})
			.orderBy(fun.coalesce(ref("block.data:prefix").castBool(), false), "asc")
			.whereIn('block.type', type ? [type] : Array.from(site.$pkg.pages));
	}

	parse(req, { url }) {
		const loc = new URL(url, req.site.url);
		const [, pathname, lang, ext] = loc.pathname.match(
			/(.+?)(?:~([a-z]{2}))?(?:\.([a-z]{3,4}))?$/
		);
		return {
			url: pathname + loc.search,
			lang,
			ext
		};
	}
	static parse = {
		title: 'Parse url',
		$lock: true,
		properties: {
			url: {
				title: 'Url path',
				type: 'string',
				format: 'pathname'
			}
		}
	};

	format(req, { url, lang, ext }) {
		const obj = new URL(url, req.site.url);
		if (lang) obj.pathname += '~' + lang;
		if (ext) obj.pathname += '.' + ext;
		return obj;
	}
	static format = {
		title: 'Format url with lang and ext',
		$lock: true,
		properties: {
			url: {
				title: 'Url path',
				type: 'string',
				format: 'pathname'
			},
			lang: {
				title: 'Lang',
				type: 'string',
				format: 'lang',
				nullable: true
			},
			ext: {
				title: 'Extension',
				type: 'string',
				pattern: /[a-z]{3,4}/.source,
				nullable: true
			}
		}
	};

	async get(req, data) {
		const { site, Href } = req;
		const { lang } = req.call('translate.lang', data);
		if (lang != data.lang) {
			data.lang = lang;
			const mapUrl = new URL(req.url, site.url);
			mapUrl.searchParams.set('lang', lang);
			req.call('cache.map', mapUrl.pathname + mapUrl.search);
		}
		const obj = {
			status: 200
		};
		let page = await this.#QueryPage(req, data);
		if (!page) {
			obj.status = 404;
		} else if (req.locked(page.lock)) {
			obj.status = 401;
		}
		const wkp = /^\/\.well-known\/(\d{3})$/.exec(data.url);
		if (obj.status != 200) {
			page = await this.#QueryPage(req, {
				url: `/.well-known/${obj.status}`,
				lang: data.lang
			});
			if (!page) return Object.assign(obj, {
				item: { type: 'page' }
			});
		} else if (wkp) {
			obj.status = parseInt(wkp[1]);
		}
		const hrefs = await req.call('href.collect', {
			ids: [page.id],
			content: true,
			asMap: true,
			types: Href.mediaTypes
		});
		const links = await navigationLinks(req, data.url, page.data.prefix, lang);

		Object.assign(obj, {
			parent: site,
			item: page,
			items: [ ...page.children, ...page.standalones ],
			links: links,
			hrefs: hrefs[0].hrefs
		});
		delete page.standalones;
		delete page.children;

		return obj;
	}
	static get = {
		title: 'Get page',
		$lock: true,
		$action: 'read',
		required: ['url'],
		properties: {
			url: {
				title: 'URL',
				type: 'string',
				format: 'pathname'
			},
			lang: {
				title: 'Translate to site lang',
				type: 'string',
				format: 'lang',
				nullable: true
			},
			type: {
				title: 'Restrict to type',
				type: 'string',
				format: 'id',
				nullable: true
			}
		}
	};

	async search(req, data) {
		const { lang } = req.call('translate.lang', data);
		return req.run('block.search', {
			lang,
			type: 'page',
			data: {
				nositemap: data.draft ? undefined : false
			},
			offset: data.offset,
			limit: data.limit,
			text: data.text
		});
	}
	static search = {
		title: 'Search pages',
		$action: 'read',
		required: ['text'],
		properties: {
			lang: {
				title: 'Lang',
				type: 'string',
				format: 'lang',
				nullable: true
			},
			text: {
				title: 'Search text',
				type: 'string',
				format: 'singleline'
			},
			content: {
				title: 'Contents',
				anyOf: [{
					const: false,
					title: 'none'
				}, {
					const: true,
					title: 'all'
				}, {
					type: 'string',
					title: 'custom'
				}]
			},
			limit: {
				title: 'Limit',
				type: 'integer',
				minimum: 0,
				maximum: 100,
				default: 10
			},
			offset: {
				title: 'Offset',
				type: 'integer',
				default: 0
			},
			drafts: {
				title: 'Show pages that are not in sitemap',
				type: 'boolean',
				default: false
			},
			type: {
				// kept for compatibility
				type: 'array',
				items: {
					type: 'string',
					format: 'name'
				},
				nullable: true
			}
		}
	};

	async save(req, changes) {
		const { site, trx } = req;
		changes = {
			// blocks removed from their standalone parent (grouped by parent)
			unrelate: {},
			// non-standalone blocks unrelated from site and deleted
			remove: [],
			// any block added and related to site
			add: [],
			// block does not change parent
			update: [],
			// block add to a new standalone parent (grouped by parent)
			relate: {},
			...changes
		};
		const pkg = site.$pkg;

		const pages = {};
		for (const method of ['add', 'update', 'remove']) {
			pages[method] = changes[method].filter(b => {
				const alias = pkg.aliases[b.type];
				if (alias) b.type = alias;
				return pkg.pages.has(b.type);
			});
		}
		pages.all = [ ...pages.add, ...pages.update ];

		for (const b of changes.add) {
			stripHostname(site, b);
		}
		for (const b of changes.update) {
			stripHostname(site, b);
		}
		// this also effectively prevents removing a page and adding a new page
		// with the same url as the one removed
		const allUrl = {};
		const returning = {};
		const dbPages = await site.$relatedQuery('children', trx)
			.select('block.id', req.ref('block.data:url').as('url'))
			.whereIn('block.type', Array.from(pkg.pages))
			.whereNotNull(req.ref('block.data:url'));
		for (const page of pages.all) {
			const { url } = page.data;
			if (!url) {
				delete page.data.url;
				continue;
			}
			if (page.data.prefix && !url.endsWith('/')) {
				throw new HttpError.BadRequest(Text`
					${page.id} must have url ending with / to be able to match
				`);
			} else if (allUrl[url]) {
				throw new HttpError.BadRequest(Text`
					${page.id} and ${allUrl[url]} have the same url
					${url}
				`);
			} else if (!page.id) {
				throw new HttpError.BadRequest(
					`Page without id: ${url}`
				);
			} else {
				allUrl[url] = page.id;
			}
		}
		for (const dbPage of dbPages) {
			const id = allUrl[dbPage.url];
			if (id != null && dbPage.id != id) {
				throw new HttpError.BadRequest(Text`
					${id} wants to take ${dbPage.id} url:
					${dbPage.url}
				`);
			}
		}

		// FIXME use site.$hrefs to track the blocks with href when saving,
		// and check all new/changed href have matching row in href table
		await applyUnrelate(req, changes.unrelate);
		await applyRemove(req, changes.remove, changes.recursive);
		returning.update = [
			...await applyAdd(req, changes.add),
			...await applyUpdate(req, changes.update)
		];
		await applyRelate(req, changes.relate);
		return returning;
	}
	static save = {
		title: 'Save page',
		$lock: true,
		$action: 'write',
		properties: {
			add: {
				type: 'array',
				items: {
					type: 'object'
				}
			},
			update: {
				type: 'array',
				items: {
					type: 'object'
				}
			},
			remove: {
				type: 'array',
				items: {
					type: 'string',
					format: 'id'
				}
			},
			relate: {
				type: 'object'
			},
			unrelate: {
				type: 'object'
			},
			recursive: {
				type: 'boolean'
			}
		}
	};

	async add(req, data) {
		await req.site.$beforeInsert.call(data);
		const obj = await this.save(req, {
			add: [data]
		});
		return obj.update[0];
	}
	static add = {
		title: 'Add page',
		$lock: true,
		$action: 'write',
		required: ['type', 'data'],
		properties: {
			type: {
				type: 'string'
			},
			data: {
				type: 'object'
			}
		}
	};


	async del({ site, trx, Href, run, ref }, data) {
		const page = await run('block.get', data);
		const links = site.$relatedQuery('children', trx)
			.select(
				'block.id',
				'block.type',
				'block.content',
				ref('parents.id').as('parentId'),
				ref('parents.data:url').as('parentUrl')
			)
			.where(ref('block.data:url').castText(), page.data.url)
			.joinRelated('parents')
			.whereNot('parents.type', 'site')
			.whereNot('parents.id', page.id);
		if (links.length > 0) {
			throw new HttpError.Conflict(Text`
				There are ${links.length} referrers to this page:
				${JSON.stringify(links, null, ' ')}
			`);
		}
		await Href.query(trx).where('url', page.data.url).del();
		return run('block.del', {
			id: page.id,
			type: page.type
		});
	}
	static del = {
		title: 'Delete page',
		$lock: true,
		$action: 'write',
		required: ['id'],
		properties: {
			id: {
				title: 'id',
				type: 'string',
				format: 'id'
			}
		}
	};

	async relink(req) {
		const pages = await req.run('page.list');
		for (const page of pages.items) {
			await req.run('href.add', {
				url: page.data.url,
				title: page.content.title
			});
		}
		return {
			count: pages.items.length
		};
	}
	static relink = {
		title: 'Reprovision all hrefs for pages',
		$lock: true,
		$action: 'write'
	};

	async list(req, data) {
		const { site, trx, fun, raw, ref } = req;
		const { lang } = req.call('translate.lang', data);
		const q = site.$relatedQuery('children', trx)
			.columns({ lang, content: 'title' })
			.select(raw("'site' || block.type AS type"))
			.whereIn('block.type', data.type ?? Array.from(site.$pkg.pages))
			.where('block.standalone', true);

		if (!data.drafts) {
			q.whereNotNull(ref('block.data:url'));
			q.where(function () {
				this.whereNull(ref('block.data:nositemap'))
					.orWhereNot(ref('block.data:nositemap'), true);
			});
		}
		if (data.robot) {
			q.where(function () {
				this.whereNull(ref('block.data:noindex'))
					.orWhereNot(ref('block.data:noindex'), true);
			});
		}
		if (data.disallow) {
			q.where(ref('block.data:noindex'), true);
		}

		if (data.parent != null) {
			const regexp = data.home ? `^${data.parent}(/[^/]+)?$` : `^${data.parent}/[^/]+$`;
			if (data.home) q.orderByRaw("block.data->>'url' = ? DESC", data.parent);
			q.whereJsonText('block.data:url', '~', regexp)
				.orderBy(ref('block.data:index'));
		} else if (data.url) {
			q.where(fun('starts_with',
				ref('block.data:url').castText(),
				data.url
			));
		} else {
			// just return all pages for the sitemap
		}
		const items = await q.orderBy(ref('block.data:url'), 'block.updated_at DESC');
		const obj = {
			items
		};
		if (data.home) {
			obj.item = items.shift();
			if (obj.item && obj.item.data.url != data.prefix) {
				delete obj.item;
			}
		}
		return obj;
	}
	static list = {
		title: 'List pages',
		$action: 'read',
		properties: {
			lang: {
				title: 'Lang',
				type: 'string',
				format: 'lang',
				nullable: true
			},
			prefix: {
				title: 'Prefix/',
				type: 'string',
				format: 'pathname'
			},
			home: {
				title: 'Home item is prefix',
				type: 'boolean',
				default: false
			},
			url: {
				title: 'Starts with',
				type: 'string',
				format: 'pathname'
			},
			drafts: {
				title: 'With drafts',
				type: 'boolean',
				default: false
			},
			robot: {
				title: 'Indexable',
				type: 'boolean',
				default: false
			},
			disallow: {
				title: 'Non-indexable',
				type: 'boolean',
				default: false
			},
			type: {
				title: 'Types',
				type: 'array',
				items: {
					type: 'string',
					format: 'name'
				},
				nullable: true
			}
		}
	};
};


function shortLink({ data, content }) {
	const obj = {};
	if (data.redirect) {
		obj.url = obj.redirect;
	} else {
		obj.url = data.url;
	}
	obj.title = content.title;
	return obj;
}

function getParents({ site, trx, ref, raw }, url, lang) {
	const urlParts = url.split('/');
	const urlParents = ['/'];
	for (let i = 1; i < urlParts.length - 1; i++) {
		urlParents.push(urlParts.slice(0, i + 1).join('/'));
	}
	return site.$relatedQuery('children', trx)
		.columns({lang, content: 'title'})
		.whereIn('block.type', Array.from(site.$pkg.pages))
		.whereJsonText('block.data:url', 'IN', urlParents)
		.orderByRaw("length(block.data->>'url') DESC");
}

function stripHostname(site, block) {
	const list = site.$hrefs[block.type];
	if (!list) return;
	for (const desc of list) {
		const url = jsonPath.get(block.data, desc.path);
		if (url) {
			const objUrl = new URL(url, site.url);
			if (objUrl.hostname == site.url.hostname) {
				jsonPath.set(block.data, desc.path, objUrl.pathname + objUrl.search + objUrl.hash);
			}
		}
	}
}

function applyUnrelate({ site, trx }, obj) {
	return Promise.all(Object.keys(obj).map(parentId => {
		return site.$relatedQuery('children', trx).where('block.id', parentId)
			.first().throwIfNotFound().then(parent => {
				return parent.$relatedQuery('children', trx)
					.unrelate()
					.whereIn('block.id', obj[parentId]);
			});
	}));
}

function applyRemove({ site, trx, ref, fun }, list, recursive) {
	if (!list.length) return;
	const q = site.$relatedQuery('children', trx).whereIn('block.id', list);
	if (!recursive) {
		q.whereNot('standalone', true).delete();
	} else {
		q.select(fun('recursive_delete', ref('block._id'), false).as('count'));
	}
	return q;
}

async function applyAdd({ site, trx, Block }, list) {
	if (!list.length) return [];
	const rows = await site.$relatedQuery('children', trx)
		.insert(list).returning('id', 'updated_at', '_id');
	return Promise.all(rows.map(async (row, i) => {
		return {
			id: row.id,
			updated_at: row.updated_at
		};
	}));
}

async function applyUpdate(req, list) {
	const blocksMap = {};
	const updates = [];
	const { site, trx } = req;

	for await (const block of list) {
		if (block.id in blocksMap) {
			block.updated_at = blocksMap[block.id];
		}
		if (site.$pkg.pages.has(block.type)) {
			updates.push(await updatePage(req, block, blocksMap));
		} else if (!block.updated_at) {
			throw new HttpError.BadRequest(`Block is missing 'updated_at' ${block.id}`);
		} else {
			// simpler path
			const row = await site.$relatedQuery('children', trx)
				.where('block.id', block.id)
				.where('block.type', block.type)
				.where(
					req.raw("date_trunc('milliseconds', block.updated_at)"),
					req.raw("date_trunc('milliseconds', ?::timestamptz)", [block.updated_at]),
				)
				.patch(block)
				.returning('id', 'updated_at')
				.first();
			if (!row) {
				throw new HttpError.Conflict(
					`${block.type}:${block.id} last update mismatch ${block.updated_at}`
				);
			} else {
				updates.push(row);
			}
		}
	}
	return updates;
}

async function updatePage({
	site, trx, ref, fun, raw, Block, Href
}, page, sideEffects) {
	if (!sideEffects) sideEffects = {};
	const dbPage = await site.$relatedQuery('children', trx)
		.where('block.id', page.id)
		.whereIn('block.type', page.type ? [page.type] : Array.from(site.$pkg.pages))
		.select('_id', ref('block.data:url').as('url'))
		.first().throwIfNotFound();

	const hrefs = site.$hrefs;
	const oldUrl = dbPage.url;
	const oldUrlStr = oldUrl == null ? '' : oldUrl;
	const newUrl = page.data.url;
	if (oldUrl != newUrl) {
		for (const [type, list] of Object.entries(hrefs)) {
			for (const desc of list) {
				if (desc.types.some(type => {
					return ['image', 'video', 'audio', 'svg'].includes(type);
				})) continue;
				const key = 'block.data:' + desc.path;
				const field = ref(key).castText();
				// this is a fake query not part of trx
				const args = field._createRawArgs(Block.query());
				try {
					const rows = await site.$relatedQuery('children', trx)
						.where('block.type', type)
						.where(function () {
							// use fn.starts_with
							this.where(fun('starts_with', field, `${oldUrlStr}/`));
							if (oldUrl == null) this.orWhereNull(field);
							else this.orWhere(field, oldUrl);
						})
						.patch({
							type,
							[key]: raw(
								`overlay(${args[0]} placing ? from 1 for ${oldUrlStr.length})`,
								args[1],
								newUrl
							)
						})
						.returning('block.id', 'block.updated_at');
					for (const row of rows) {
						const date = row.updated_at;
						sideEffects[row.id] = date;
						if (page.id == row.id) page.updated_at = date;
					}
				} catch (err) {
					console.error(`Error with type: ${type}, key: ${key}`);
					throw err;
				}
			}
		}
	}

	await Href.query(trx).where('_parent_id', site._id)
		.where('type', 'link')
		.where(function () {
			this.where(fun('starts_with', 'url', `${oldUrlStr}/`));
			if (oldUrl == null) this.orWhereNull('url');
			else this.orWhere('url', oldUrl);
		}).delete();
	const row = await site.$relatedQuery('children', trx)
		.where('block.id', page.id)
		.where(
			raw("date_trunc('milliseconds', block.updated_at)"),
			raw("date_trunc('milliseconds', ?::timestamptz)", [page.updated_at]),
		)
		.patch(page)
		.returning('block.id', 'block.updated_at')
		.first();
	if (!row) {
		throw new HttpError.Conflict(
			`${page.type}:${page.id} last update mismatch ${page.updated_at}`
		);
	}
	return row;
}

async function applyRelate({ site, trx }, obj) {
	return Promise.all(Object.keys(obj).map(async parentId => {
		const parent = await site.$relatedQuery('children', trx)
			.where('block.id', parentId)
			.first().throwIfNotFound();
		const ids = await site.$relatedQuery('children', trx)
			.whereIn('block.id', obj[parentId])
			.select('block.id', 'block._id', 'block.standalone', 'rel.child_id')
			.leftOuterJoin('relation as rel', function () {
				this.on('rel.parent_id', '=', parent._id)
					.andOn('rel.child_id', '=', 'block._id');
			});
		// do not relate again
		const unrelateds = ids.filter(item => !item.child_id);
		if (ids.length != obj[parentId].length) {
			const missing = obj[parentId].reduce((list, id) => {
				if (!ids.some(item => {
					return item.id === id;
				})) list.push(id);
				return list;
			}, []);
			throw new HttpError.NotFound("Unknown blocks: " + missing.join(', '));
		}
		return parent.$relatedQuery('children', trx).relate(unrelateds);
	}));
}

async function navigationLinks(req, url, prefix, lang) {
	const [parents, { items:siblings }] = await Promise.all([
		getParents(req, url, lang),
		prefix ? { items: [] } : req.call('page.list', {
			lang,
			drafts: true,
			prefix: url.split('/').slice(0, -1).join('/')
		})
	]);
	const links = {};
	links.up = parents.map(shortLink);

	// consider not doing this for prefixed pages
	let found;
	const position = siblings.findIndex(item => {
		const same = item.data.url == url;
		if (same) {
			found = true;
		} else if (!found && url.length > 1 && item.data.url.startsWith(url)) {
			found = item.url;
		}
		return same;
	});
	if (found && found !== true) {
		links.found = found;
	}
	if (position > 0) {
		links.prev = shortLink(siblings[position - 1]);
	}
	if (position < siblings.length - 1) {
		links.next = shortLink(siblings[position + 1]);
	}
	if (siblings.length > 1) {
		links.first = shortLink(siblings[0]);
		links.last = shortLink(siblings[siblings.length - 1]);
	}
	return links;
}
