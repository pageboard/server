const { ref, raw } = require('objection');
const jsonPath = require.lazy('@kapouer/path');

module.exports = class PageService {
	static name = 'page';

	apiRoutes(app, server) {
		server.get('/.api/page', async (req, res) => {
			const { site, query } = req;
			const isWebmaster = !req.locked(['webmaster']);
			const dev = query.develop == "write";
			delete query.develop;
			if (isWebmaster && !dev) {
				res.return({
					item: {
						type: 'write',
						data: {}
					},
					meta: Object.assign({
						services: site.$pkg.services
					}, site.$pkg.bundles.write.meta),
					site: site.data,
					commons: app.opts.commons
				});
			} else {
				const data = await req.run('page.get', query);
				const resources = site.$pkg.bundles.write.meta.resources;
				if (dev && resources.develop) {
					if (!data.meta) data.meta = { scripts: [] };
					if (site.$pkg.bundles.user) {
						data.meta.scripts.unshift(site.$pkg.bundles.user.meta.bundle);
					}
					data.meta.scripts.unshift(resources.develop);
					data.meta.writes = {
						scripts: [resources.editor, resources.readScript],
						stylesheets: [resources.readStyle]
					};
				}
				data.commons = app.opts.commons;
				res.return(data);
			}
		});
		server.get('/.api/pages', async (req, res) => {
			const { query, site } = req;
			const isWebmaster = !req.locked(['webmaster']);
			if (isWebmaster) {
				// webmaster want to see those anyway
				// this must not be confused with page.lock
				query.drafts = true;
				if (!query.type) {
					query.type = site.$pkg.pages;
				}
			} else if (!query.type) {
				query.type = ['page', 'blog'];
			}

			const action = query.text != null ? 'page.search' : 'page.all';
			const obj = await req.run(action, query);
			res.return(obj);
		});
		server.post('/.api/page', app.auth.lock('webmaster'), async (req, res) => {
			const page = await req.run('page.add', req.body);
			// FIXME use res.return ?
			res.send(page);
		});
		server.put('/.api/page', app.auth.lock('webmaster'), async (req, res) => {
			const page = await req.run('page.save', req.body);
			res.send(page);
		});
		server.delete('/.api/page', app.auth.lock('webmaster'), async (req, res) => {
			const page = await req.run('page.del', req.query);
			res.send(page);
		});

		server.get('/robots.txt', app.cache.tag('data-:site'), async (req, res) => {
			const txt = await req.run('page.robots');
			res.type('text/plain');
			res.send(txt);
		});

		server.get('/sitemap.txt', app.cache.tag('data-:site'), async (req, res) => {
			const obj = await req.run('page.all', {
				robot: true,
				type: ['page', 'blog'] // TODO do not return pages that require a query
				// TODO do not return pages that do not have a properties.nositemap (nor sitemap)
			});
			res.type('text/plain');
			app.auth.filter(req, obj);
			res.send(obj.items.map(page => {
				return new URL(page.data.url, req.site.url).href;
			}).join('\n'));
		});
	}

	#QueryPage({ site, trx }) {
		return site.$relatedQuery('children', trx).alias('page')
			.select()
			.first()
			// eager load children (in which there are standalones)
			// and children of standalones
			.withGraphFetched(`[
				children(childrenFilter),
				children(standalonesFilter) as standalones .children(childrenFilter)
			]`).modifiers({
				childrenFilter(query) {
					return query.select().where('page.standalone', false);
				},
				standalonesFilter(query) {
					return query.select().where('page.standalone', true);
				}
			});
	}

	async get(req, data) {
		const { site } = req;
		const obj = {
			status: 200,
			site: site.data
		};

		const wkp = /^\/\.well-known\/(\d{3})$/.exec(data.url);
		if (wkp) {
			obj.status = parseInt(wkp[1]);
		}
		let page = await this.#QueryPage(req).whereIn('page.type', site.$pkg.pages)
			.whereJsonText("page.data:url", data.url)
			.select(
				req.call('href.collect', {
					url: data.url,
					content: true,
					map: true
				}).as('hrefs')
			);
		if (!page) {
			obj.status = 404;
		} else if (req.locked((page.lock || {}).read)) {
			obj.status = 401;
		}
		if (obj.status != 200) {
			const statusUrl = `/.well-known/${obj.status}`;
			page = await this.#QueryPage(req)
				.where('page.type', 'page')
				.whereJsonText("page.data:url", statusUrl)
				.select(
					req.call('href.collect', {
						url: statusUrl,
						content: true,
						map: true
					}).as('hrefs')
				);
			if (!page) throw new HttpError[obj.status]();
		}
		const links = {};
		Object.assign(obj, {
			item: page,
			items: (page.children || []).concat(page.standalones || []),
			meta: site.$pkg.bundles[page.type].meta,
			links: links,
			hrefs: page.hrefs
		});
		delete page.standalones;
		delete page.children;
		delete page.hrefs;

		const [parents, siblings] = await Promise.all([
			getParents(req, data.url),
			listPages(req, {
				drafts: true,
				parent: data.url.split('/').slice(0, -1).join('/')
			}).clearSelect().select([
				ref('block.data:url').as('url'),
				ref('block.data:redirect').as('redirect'),
				ref('block.data:title').as('title')
			])
		]);
		links.up = parents.map(redUrl);
		let found;
		const position = siblings.findIndex(item => {
			const same = item.url == data.url;
			if (same) {
				found = true;
			} else if (!found && data.url.length > 1 && item.url.startsWith(data.url)) {
				found = item.url;
			}
			return same;
		});
		if (found && found !== true) {
			links.found = found;
		}
		if (position > 0) {
			links.prev = redUrl(siblings[position - 1]);
		}
		if (position < siblings.length - 1) {
			links.next = redUrl(siblings[position + 1]);
		}
		if (siblings.length > 1) {
			links.first = redUrl(siblings[0]);
			links.last = redUrl(siblings[siblings.length - 1]);
		}
		return obj;
	}
	static get = {
		$action: 'read',
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'pathname'
			}
		}
	};

	async search({ site, trx }, data) {
		const drafts = data.drafts
			? ''
			: `AND (page.data->'nositemap' IS NULL OR (page.data->'nositemap')::BOOLEAN IS NOT TRUE)`;

		const types = data.type || site.$pkg.pages;

		const results = await trx.raw(`SELECT json_build_object(
			'count', count,
			'rows', json_agg(
				json_build_object(
					'id', id,
					'type', type,
					'updated_at', updated_at,
					'data', json_build_object(
						'title', title,
						'url', url,
						'headlines', headlines,
						'rank', rank
					)
				)
			)) AS result FROM (
			SELECT
				id, type, title, url, updated_at, json_agg(DISTINCT headlines) AS headlines, sum(qrank) AS rank,
				count(*) OVER() AS count
			FROM (
				SELECT
					page.id,
					page.type,
					page.data->>'title' AS title,
					page.data->>'url' AS url,
					page.updated_at,
					(SELECT string_agg(heads.value, '<br>') FROM (SELECT DISTINCT trim(value) AS value FROM jsonb_each_text(ts_headline('unaccent', block.content, search.query)) WHERE length(trim(value)) > 0) AS heads) AS headlines,
					ts_rank(block.tsv, search.query) AS qrank
				FROM
					block AS site,
					relation AS rs,
					block,
					relation AS rp,
					block AS page,
					(SELECT websearch_to_tsquery('unaccent', ?) AS query) AS search
				WHERE
					site.type = 'site' AND site.id = ?
					AND rs.parent_id = site._id AND block._id = rs.child_id
					AND block.type NOT IN ('site', 'user', 'fetch', 'template', 'api_form', 'query_form', 'priv', 'settings', ${site.$pkg.pages.map(_ => '?').join(',')})
					AND rp.child_id = block._id AND page._id = rp.parent_id
					${drafts}
					AND page.type IN (${types.map(_ => '?').join(',')})
					AND search.query @@ block.tsv
			) AS results
			GROUP BY id, type, title, url, updated_at ORDER BY rank DESC, updated_at DESC OFFSET ? LIMIT ?
		) AS foo GROUP BY count`, [
			data.text,
			site.id,
			...site.$pkg.pages,
			...types,
			data.offset,
			data.limit
		]);
		const obj = {
			offset: data.offset,
			limit: data.limit,
			total: 0
		};
		if (results.rowCount == 0) {
			obj.items = [];
		} else {
			const result = results.rows[0].result;
			obj.items = result.rows;
			obj.total = result.count;
		}
		return obj;
	}
	static search = {
		title: 'Search pages',
		$action: 'read',
		external: true,
		required: ['text'],
		properties: {
			text: {
				title: 'Search text',
				type: 'string',
				format: 'singleline'
			},
			limit: {
				title: 'Limit',
				type: 'integer',
				minimum: 0,
				maximum: 50,
				default: 10
			},
			offset: {
				title: 'Offset',
				type: 'integer',
				minimum: 0,
				default: 0
			},
			drafts: {
				title: 'Show pages that are not in sitemap',
				type: 'boolean',
				default: false
			},
			type: {
				type: 'array',
				items: {
					type: 'string',
					format: 'name'
				},
				nullable: true
			}
		}
	};

	async all(req, data) {
		const pages = await listPages(req, data);
		const els = {};
		const obj = {
			items: pages
		};
		if (data.home) {
			obj.item = pages.shift();
			if (obj.item && obj.item.data.url != data.parent) {
				delete obj.item;
			}
		} else {
			for (const type of req.site.$pkg.pages) {
				const schema = req.site.$schema(type);
				els[type] = schema;
			}
			obj.item = {
				type: 'sitemap'
			};
			obj.meta = {
				elements: els
			};
		}
		return obj;
	}
	static all = {
		title: 'Site map',
		$action: 'read',
		external: true,
		properties: {
			parent: {
				title: 'Root pathname',
				type: 'string',
				format: 'pathname'
			},
			home: {
				title: 'Returns root as first item',
				type: 'boolean',
				default: false
			},
			url: {
				type: 'string',
				format: 'pathname'
			},
			limit: {
				title: 'Limit',
				type: 'integer',
				minimum: 0
			},
			offset: {
				title: 'Offset',
				type: 'integer',
				minimum: 0,
				default: 0
			},
			drafts: {
				type: 'boolean',
				default: false
			},
			robot: {
				type: 'boolean',
				default: false
			},
			type: {
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
		changes = Object.assign({
			// blocks removed from their standalone parent (grouped by parent)
			unrelate: {},
			// non-standalone blocks unrelated from site and deleted
			remove: [],
			// any block added and related to site
			add: [],
			// block does not change parent
			update: [],
			// block add to a new standalone parent (grouped by parent)
			relate: {}
		}, changes);

		const pages = {
			add: changes.add.filter(b => b.type == "page"),
			update: changes.update.filter(b => b.type == "page")
		};
		pages.all = pages.add.concat(pages.update);

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
			.select('block.id', ref('block.data:url').as('url'))
			.whereIn('block.type', site.$pkg.pages)
			.whereNotNull(ref('block.data:url'));
		for (const page of pages.all) {
			if (!page.data.url) {
				delete page.data.url;
			} else if (allUrl[page.data.url]) {
				throw new HttpError.BadRequest(Text`
					${page.id} and ${allUrl[page.data.url]} have the same url
					${page.data.url}
				`);
			} else if (!page.id) {
				throw new HttpError.BadRequest(
					`Page without id: ${page.data.url}`
				);
			} else {
				allUrl[page.data.url] = page.id;
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

		// FIXME use site.$model.hrefs to track the blocks with href when saving,
		// and check all new/changed href have matching row in href table
		await applyUnrelate(req, changes.unrelate);
		await applyRemove(req, changes.remove, changes.recursive);
		returning.update = (
			await applyAdd(req, changes.add) || []
		).concat(
			await applyUpdate(req, changes.update) || []
		);
		await applyRelate(req, changes.relate);
		await Promise.all(pages.update.map(async child => {
			if (!child.data.url || child.data.url.startsWith('/.')) return;
			try {
				await req.run('href.save', {
					url: child.data.url,
					title: child.data.title
				});
			} catch (err) {
				if (err.statusCode == 404) try {
					await req.run('href.add', {
						url: child.data.url
					});
				} catch (err) {
					console.error(err);
				} else {
					console.error(err);
				}
			}
		}));
		await Promise.all(pages.add.map(async child => {
			if (!child.data.url || child.data.url.startsWith('/.')) return;
			// problem: added pages are not saved here
			try {
				await req.run('href.add', {
					url: child.data.url
				});
			} catch (err) {
				console.error(err);
			}
		}));
		return returning;
	}
	static save = {
		$action: 'save',
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
			}
		}
	};

	async add(req, data) {
		await req.site.$beforeInsert.call(data);
		return this.save(req, {
			add: [data]
		});
	}
	static add = {
		$action: 'add',
		properties: {
			type: {
				'enum': ["page", "mail"],
				default: "page"
			},
			data: {
				type: 'object'
			}
		}
	};


	async del(req, data) {
		const { site, trx, Href } = req;
		const page = await req.run('block.get', data);
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
		return req.run('block.del', {
			id: page.id,
			type: page.type
		});
	}
	static del = {
		$action: 'del',
		required: ['id'],
		properties: {
			id: {
				title: 'id',
				type: 'string',
				format: 'id'
			}
		}
	};

	async robots(req) {
		const { site } = req;
		const lines = [];
		if (site.data.env == "production") {
			lines.push(`Sitemap: ${new URL("/sitemap.txt", site.url)}`);
			lines.push('User-agent: *');
			const pages = await listPages(req, {
				disallow: true,
				type: ['page', 'blog']
			});
			for (const page of pages) {
				lines.push(`Disallow: ${page.data.url}`);
			}
		} else {
			lines.push('User-agent: *');
			lines.push("Disallow: /");
		}
		return lines.join('\n');
	}
	static robots = {
		$action: 'read'
	};
};



function redUrl(obj) {
	if (obj.redirect) {
		obj.url = obj.redirect;
	}
	delete obj.redirect;
	return obj;
}

function getParents({ site, trx }, url) {
	const urlParts = url.split('/');
	const urlParents = ['/'];
	for (let i = 1; i < urlParts.length - 1; i++) {
		urlParents.push(urlParts.slice(0, i + 1).join('/'));
	}
	return site.$relatedQuery('children', trx)
		.select([
			ref('block.data:url').as('url'),
			ref('block.data:redirect').as('redirect'),
			ref('block.data:title').as('title')
		])
		.whereIn('block.type', site.$pkg.pages)
		.whereJsonText('block.data:url', 'IN', urlParents)
		.orderByRaw("length(block.data->>'url') DESC");
}

function listPages({ site, trx }, data) {
	const q = site.$relatedQuery('children', trx)
		.selectWithout('content')
		.whereIn('block.type', data.type || site.$pkg.pages)
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
		q.whereJsonText('block.data:url', 'LIKE', `${data.url || ''}%`);
	} else {
		// just return all pages for the sitemap
	}
	if (data.limit) q.limit(data.limit);
	if (data.offset) q.offset(data.offset);
	return q.orderBy(ref('block.data:url'), 'block.updated_at DESC');
}

function stripHostname(site, block) {
	const list = site.$model.hrefs[block.type];
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
	return Promise.all(Object.keys(obj).map((parentId) => {
		return site.$relatedQuery('children', trx).where('block.id', parentId)
			.first().throwIfNotFound().then((parent) => {
				return parent.$relatedQuery('children', trx)
					.unrelate()
					.whereIn('block.id', obj[parentId]);
			});
	}));
}

function applyRemove({ site, trx }, list, recursive) {
	if (!list.length) return;
	const q = site.$relatedQuery('children', trx).whereIn('block.id', list);
	if (!recursive) {
		return q.whereNot('standalone', true);
	} else {
		return q.select(raw('recursive_delete(block._id, FALSE) AS count'));
	}
}

function applyAdd({ site, trx }, list) {
	if (!list.length) return;
	// this relates site to inserted children
	return site.$relatedQuery('children', trx).insert(list).returning('*').then((rows) => {
		return rows.map((row) => {
			return {
				id: row.id,
				updated_at: row.updated_at
			};
		});
	});
}

function applyUpdate(req, list) {
	const blocksMap = {};
	const updates = [];
	return list.reduce((p, block) => {
		return p.then(() => {
			if (block.id in blocksMap) block.updated_at = blocksMap[block.id];
			if (req.site.$pkg.pages.includes(block.type)) {
				return updatePage(req, block, blocksMap);
			} else if (!block.updated_at) {
				throw new HttpError.BadRequest(`Block is missing 'updated_at' ${block.id}`);
			} else {
				// simpler path
				return req.site.$relatedQuery('children', req.trx)
					.where('block.id', block.id)
					.where('block.type', block.type)
					.where(raw("date_trunc('milliseconds', block.updated_at)"), block.updated_at)
					.patch(block)
					.returning('id', 'updated_at')
					.first()
					.then((part) => {
						if (!part) {
							throw new HttpError.Conflict(`${block.type}:${block.id} last update mismatch ${block.updated_at}`);
						}
						return part;
					});
			}
		}).then((update) => {
			updates.push(update);
		});
	}, Promise.resolve()).then(() => {
		return updates;
	});
}

async function updatePage({ site, trx, Block, Href }, page, sideEffects) {
	if (!sideEffects) sideEffects = {};
	const dbPage = await site.$relatedQuery('children', trx)
		.where('block.id', page.id)
		.whereIn('block.type', page.type ? [page.type] : site.$pkg.pages)
		.select(ref('block.data:url').as('url'))
		.first().throwIfNotFound();

	const hrefs = site.$model.hrefs;
	const oldUrl = dbPage.url;
	const oldUrlStr = oldUrl == null ? '' : oldUrl;
	const newUrl = page.data.url;
	if (oldUrl != newUrl) {
		await Promise.all(Object.keys(hrefs).map(async type => {
			await Promise.all(hrefs[type].map(async desc => {
				const key = 'block.data:' + desc.path;
				const field = ref(key).castText();
				// this is a fake query not part of trx
				const args = field._createRawArgs(Block.query());
				const rows = await site.$relatedQuery('children', trx)
					.where('block.type', type)
					.where(function () {
						this.where(field, 'LIKE', `${oldUrlStr}/%`);
						if (oldUrl == null) this.orWhereNull(field);
						else this.orWhere(field, oldUrl);
					})
					.patch({
						[key]: raw(
							`overlay(${args[0]} placing ? from 1 for ${oldUrlStr.length})`,
							args[1],
							newUrl
						)
					})
					.returning('block.id', 'block.updated_at');
				for (const row of rows) {
					const date = row.updated_at.toISOString();
					sideEffects[row.id] = date;
					if (page.id == row.id) page.updated_at = date;
				}
			})).catch((err) => {
				console.error("Error with updatePage side effects", err);
				throw err;
			});
		}));
	}

	await Href.query(trx).where('_parent_id', site._id)
		.where('type', 'link')
		.where(function () {
			this.where('url', 'LIKE', `${oldUrlStr}/%`);
			if (oldUrl == null) this.orWhereNull('url');
			else this.orWhere('url', oldUrl);
		}).delete();
	const part = await site.$relatedQuery('children', trx)
		.where('block.id', page.id)
		.where(
			raw("date_trunc('milliseconds', block.updated_at)"),
			page.updated_at
		)
		.patch(page)
		.returning('block.id', 'block.updated_at')
		.first();
	if (!part) {
		throw new HttpError.Conflict(
			`${page.type}:${page.id} last update mismatch ${page.updated_at}`
		);
	}
	return part;
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
				if (!ids.some((item) => {
					return item.id === id;
				})) list.push(id);
				return list;
			}, []);
			throw HttpError(404, "Unknown blocks", { blocks: missing });
		}
		return parent.$relatedQuery('children', trx).relate(unrelateds);
	}));
}

