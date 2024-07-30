const jsonPath = require.lazy('@kapouer/path');

module.exports = class PageService {
	static name = 'page';

	apiRoutes(app) {
		app.get('/@api/page/find', async req => {
			const { site, query } = req;
			const { url, lang, ext } = req.call('page.parse', query);
			const isWebmaster = !req.locked(['webmaster']) && query.url == url;
			const forWebmaster = Boolean(query.nested);
			delete query.nested;

			if (isWebmaster || forWebmaster) {
				// override browser accepted-language
				req.call('translate.lang', {
					lang: lang ?? site.data.languages?.[0] ?? site.data.lang
				});
			}

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
			return obj;
		});
		app.get('/@api/page/search', async req => {
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
			return obj;
		});

		app.post('/@api/page/write', 'page.write');
	}

	#QueryPage({ site, trx, ref, val, fun }, { url, lang, type }) {
		return site.$relatedQuery('children', trx)
			.columns({ lang })
			.first()
			// eager load children (in which there are standalones)
			// and children of standalones
			.withGraphFetched(`[
				children(childrenFilter) as children,
				children(standalonesFilter) as standalones .children(childrenFilter)
			]`).modifiers({
				childrenFilter(q) {
					q.columns({ lang })
						.where('block.standalone', false)
						.whereNot('block.type', 'content');
				},
				standalonesFilter(q) {
					q.columns({ lang })
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
		const loc = new URL(url, req.site.$url);
		const [, pathname, lang, ext] = loc.pathname.match(
			/^((?:\/.well-known\/\d{3})|(?:(?:\/[a-zA-Z0-9-]*)+?))(?:~([a-z]{2}(?:-[a-z]{2})?))?(?:\.([a-z]{3,4}))?$/
		) ?? [];
		return {
			url: pathname == null ? undefined : pathname + loc.search,
			pathname,
			lang,
			ext
		};
	}
	static parse = {
		title: 'Parse URL',
		$private: true,
		properties: {
			url: {
				title: 'Url path',
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	format(req, { url, lang, ext }) {
		const obj = new URL(url, req.site.$url);
		if (lang) obj.pathname += '~' + lang;
		if (ext) obj.pathname += '.' + ext;
		return obj;
	}
	static format = {
		title: 'Format url with lang and ext',
		$private: true,
		properties: {
			url: {
				title: 'Url path',
				type: 'string',
				format: 'uri-reference'
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
			const mapUrl = new URL(req.url, site.$url);
			mapUrl.searchParams.set('url', this.format(req, {
				url: data.url,
				lang: data.lang,
				ext: data.type
			}).pathname);
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
		const hrefs = await req.run('href.collect', {
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
			links,
			hrefs
		});
		delete page.standalones;
		delete page.children;

		return obj;
	}
	static get = {
		title: 'Get',
		$private: true,
		$action: 'read',
		required: ['url'],
		properties: {
			url: {
				title: 'URL',
				type: 'string',
				format: 'page'
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
			content: data.content,
			data: {
				nositemap: data.draft ? undefined : false
			},
			offset: data.offset,
			limit: data.limit,
			text: data.text
		});
	}
	static search = {
		title: 'Search',
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
			content: {
				title: 'Contents',
				type: 'array',
				nullable: true,
				items: {
					type: 'string',
					format: 'name',
					title: 'Custom',
				},
				$filter: {
					name: 'element-content'
				}
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

	async write(req, changes) {
		const { site } = req;
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

		for (const b of changes.add) {
			stripHostname(site, b);
		}
		for (const b of changes.update) {
			stripHostname(site, b);
		}
		const returning = {};

		await applyUnrelate(req, changes.unrelate);
		await applyRemove(req, changes.remove, changes.recursive);
		returning.update = [
			...await applyAdd(req, changes.add),
			...await applyUpdate(req, changes.update)
		];
		await applyRelate(req, changes.relate);
		return returning;
	}
	static write = {
		title: 'Write content',
		$private: true,
		$lock: ['webmaster'],
		$tags: ['data-:site'],
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

	async list(req, data) {
		const { site, trx, fun, ref } = req;
		const { lang } = req.call('translate.lang', data);
		const q = site.$relatedQuery('children', trx)
			.columns({ lang, content: ['title'] })
			.whereIn('block.type', data.type ?? Array.from(site.$pkg.pages))
			.where('block.standalone', true);

		if (!data.drafts) {
			q.whereNotNull(ref('block.data:url'));
			q.where(q => {
				q.whereNull(ref('block.data:nositemap'))
					.orWhereNot(ref('block.data:nositemap'), true);
			});
		}
		if (data.robot) {
			q.where(q => {
				q.whereNull(ref('block.data:noindex'))
					.orWhereNot(ref('block.data:noindex'), true);
			});
		}
		if (data.disallow) {
			q.where(ref('block.data:noindex'), true);
		}
		const obj = {};
		if (data.prefix != null) {
			const prefix = data.prefix.replace(/\/$/, '');
			q.whereJsonText('block.data:url', '~', `^${prefix}/[^/]*$`)
				.orderBy(ref('block.data:index').castInt());
			const parents = await getParents(req, prefix, lang);
			obj.links = {
				up: parents.map(shortLink)
			};
		} else if (data.url) {
			q.where(fun('starts_with',
				ref('block.data:url').castText(),
				data.url
			));
		} else {
			// just return all pages for the sitemap
		}
		q.orderBy(ref('block.data:url'));
		q.orderBy(ref('block.updated_at'), 'DESC');
		obj.items = await q;
		return obj;
	}
	static list = {
		title: 'List',
		$action: 'read',
		properties: {
			prefix: {
				title: 'By url prefix',
				type: 'string',
				format: 'page',
				$helper: "page",
				nullable: true
			},
			url: {
				title: 'Starts with',
				type: 'string',
				format: 'page'
			},
			lang: {
				title: 'Lang',
				type: 'string',
				format: 'lang',
				nullable: true
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

function getParents({ site, trx }, url, lang) {
	const urlParts = url.split('/');
	const urlParents = ['/'];
	for (let i = 1; i < urlParts.length - 1; i++) {
		urlParents.push(urlParts.slice(0, i + 1).join('/'));
	}
	return site.$relatedQuery('children', trx)
		.columns({ lang, content: ['title'] })
		.whereIn('block.type', Array.from(site.$pkg.pages))
		.whereJsonText('block.data:url', 'IN', urlParents)
		.orderByRaw("length(block.data->>'url') DESC");
}

function stripHostname(site, block) {
	const list = site.$pkg.hrefs[block.type];
	if (!list) return;
	for (const desc of list) {
		const url = jsonPath.get(block.data, desc.path);
		if (url) {
			const objUrl = new URL(url, site.$url);
			if (objUrl.hostname == site.$url.hostname) {
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
	const updates = [];
	const { site, trx } = req;

	for await (const block of list) {
		if (!block.updated_at) {
			throw new HttpError.BadRequest(`Block is missing 'updated_at' ${block.id}`);
		}
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
	return updates;
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
