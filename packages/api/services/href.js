const { promises: fs } = require('node:fs');
const jsonPath = require.lazy('@kapouer/path');


module.exports = class HrefService {
	static name = 'href';

	constructor(app) {
		this.app = app;
	}

	apiRoutes(app) {
		app.get("/@api/hrefs", 'href.search');
		app.get("/@api/href", 'href.find');
		app.post("/@api/href", 'href.add');
	}

	get({ Href, site, trx }, data) {
		return Href.query(trx).select('href._id')
			.whereSite(site.id)
			.where('href.url', data.url).first();
	}

	async find({ Href, site, trx }, data) {
		const href = await Href.query(trx).columns()
			.whereSite(site.id)
			.where('href.url', data.url).first().throwIfNotFound();
		return { href };
	}
	static find = {
		title: 'Find',
		$action: 'read',
		$lock: 'user',
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	async search(req, data) {
		const { Href, site, trx } = req;
		const q = Href.query(trx).columns().whereSite(site.id);
		const { type, maxSize, maxWidth, maxHeight } = data;
		let { offset, limit } = data;

		if (type) {
			q.whereIn('href.type', type);
		}
		if (maxSize) {
			q.where(req.ref('href.meta:size'), '<=', maxSize);
		}
		if (maxWidth) {
			q.where(req.ref('href.meta:width'), '<=', maxWidth);
		}
		if (maxHeight) {
			q.where(req.ref('href.meta:height'), '<=', maxHeight);
		}
		if (offset < 0) {
			limit += offset;
			offset = 0;
			if (limit < 0) {
				throw new HttpError.BadRequest("limit cannot be negative");
			}
		}

		if (data.url) {
			const [url, hash] = data.url.split('#');
			q.where('url', url);
			if (url.startsWith('/') && hash != null) {
				const href = await q.first();
				if (href) {
					const obj = await req.run('block.search', {
						parent: {
							type: Array.from(site.$pkg.pages),
							data: {
								url: url
							}
						},
						type: site.$pkg.hashtargets,
						offset,
						limit,
						data: {
							'id:start': hash
						}
					});
					obj.hrefs = obj.items.map(item => ({
						...href,
						title: `${href.title} #${item.data.id}`,
						url: `${href.url}#${item.data.id}`
					}));
					delete obj.items;
					return obj;
				} else {
					return { count: 0, hrefs: [], offset, limit };
				}
			}
		} else if (data.text) {
			if (/^\w+$/.test(data.text)) {
				q.from(req.raw("to_tsquery('unaccent', ?) AS query, ??", [data.text + ':*', 'href']));
			} else {
				q.from(req.raw("websearch_to_tsquery('unaccent', href_tsv_url(?)) AS query, ??", [data.text, 'href']));
			}
			q.whereRaw('query @@ href.tsv');
			q.orderByRaw('ts_rank(href.tsv, query) DESC');
			q.orderBy(req.ref('href.url'));
			q.orderBy('updated_at', 'desc');
		} else {
			q.orderBy('updated_at', 'desc');
		}
		const [hrefs, count] = await Promise.all([
			q.offset(offset).limit(limit),
			q.resultSize()
		]);
		return {
			hrefs,
			offset,
			limit,
			count
		};
	}

	static search = {
		title: 'Search',
		$action: 'read',
		$lock: 'webmaster',
		properties: {
			type: {
				type: 'array',
				items: {
					type: 'string',
					format: 'name'
				}
			},
			maxSize: {
				type: 'integer',
				minimum: 0
			},
			maxWidth: {
				type: 'integer',
				minimum: 0
			},
			maxHeight: {
				type: 'integer',
				minimum: 0
			},
			url: {
				type: 'string',
				format: 'uri-reference'
			},
			text: {
				type: 'string',
				format: 'singleline'
			},
			limit: {
				type: 'integer',
				minimum: 0,
				maximum: 1000,
				default: 10
			},
			offset: {
				type: 'integer',
				default: 0
			}
		}
	};

	async add(req, data) {
		try {
			return await req.run('href.find', data);
		} catch(err) {
			const href = await this.#add(req, data);
			return { href };
		}
	}

	async #add(req, data) {
		const { site, trx, Href } = req;
		let local = false;
		const siteUrl = site.$url ?? new URL(`https://${site.id}.localhost.localdomain`);
		const fullUrl = new URL(data.url, siteUrl);
		if (siteUrl.hostname == fullUrl.hostname) {
			data.url = fullUrl.pathname + fullUrl.search;
			local = true;
		}

		let result;
		if (local && !fullUrl.pathname.startsWith('/@')) {
			const { item } = await req.run('block.find', {
				type: site.$pkg.standalones,
				content: 'title',
				data: {
					url: fullUrl.pathname
				}
			});
			if (!item) {
				throw new HttpError.NotFound("inspect cannot find block: " + fullUrl.pathname);
			}
			result = {
				mime: 'text/html; charset=utf-8',
				type: 'link',
				title: item.content.title,
				site: null,
				pathname: fullUrl.pathname,
				url: fullUrl.pathname + fullUrl.search
			};
		} else {
			result = await this.inspect(req, { url: data.url });
			result.pathname = data.pathname ?? fullUrl.pathname;
		}
		if (!local && result.url != data.url) {
			result.canonical = result.url;
			result.url = data.url;
		}
		const href = await this.get(req, data).forUpdate();
		if (!href) {
			return site.$relatedQuery('hrefs', trx)
				.insert(result)
				.returning(Href.columns);
		} else {
			return site.$relatedQuery('hrefs', trx)
				.patchObject(result)
				.where('_id', href._id)
				.first()
				.returning(Href.columns);
		}
	}

	static add = {
		title: 'Add',
		$action: 'write',
		$tags: ['data-:site'],
		$lock: 'user',
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			},
			pathname: {
				type: 'string',
				format: 'pathname',
				nullable: true
			}
		}
	};

	async update(req, data) {
		const { Href, site, trx } = req;
		const { url } = data;
		const copy = { ...data };
		delete copy.url;
		const href = await this.get(req, { url })
			.throwIfNotFound()
			.forUpdate();
		return site.$relatedQuery('hrefs', trx)
			.where('_id', href._id)
			.first()
			.patchObject(copy)
			.returning(Href.columns);
	}
	static update = {
		title: 'Update title and pathname',
		$action: 'write',
		$private: true,
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			},
			title: {
				type: 'string',
				format: 'singleline'
			},
			pathname: {
				type: 'string',
				format: 'pathname'
			}
		}
	};

	async save(req, data) {
		return req.call('image.update', data);
	}
	static save = {
		title: 'Update title',
		$action: 'write',
		required: ['url', 'title'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			},
			title: {
				type: 'string',
				format: 'singleline'
			}
		}
	};

	async del(req, data) {
		const count = await this.get(req, data).delete();
		return { count };
	}
	static del = {
		title: 'Delete',
		$action: 'write',
		$tags: ['data-:site'],
		$lock: 'webmaster',
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	async referrers(req, { ids = [], url, limit, offset }) {
		const { site, trx, ref } = req;
		const { hrefs, standalones, pages } = site.$pkg;
		const qList = q => {
			const urlQueries = [];
			for (const [type, list] of Object.entries(hrefs)) {
				for (const desc of list) {
					const bq = site.$modelClass.query(trx).from('block')
						.select('block.id')
						.where('block.type', type)
						.whereNotNull(req.ref(`block.data:${desc.path}`));
					if (desc.array) {
						bq.where(
							req.raw("jsonb_typeof(??)", [req.ref(`block.data:${desc.path}`)]),
							'array'
						);
					}
					urlQueries.push(bq);
				}
			}
			q.union(urlQueries, true);
		};
		const pageTypes = Array.from(pages);
		const q = site.$relatedQuery('children', trx)
			.with('list', qList)
			.join('list', 'list.id', 'block.id')
			.distinct('parents.id', 'parents.type')
			.where(ref('block.data:url').castText(), url)
			.joinRelated('parents.[parents as roots]')
			.whereNot('parents.type', 'site')
			.whereNotIn('block.type', pageTypes)
			.where(q => {
				q.where(q => {
					q.where('parents:roots.type', 'site');
					q.where('parents.type', pageTypes);
					if (ids.length) q.whereNotIn('parents.id', ids);
				});
				q.orWhere(q => {
					q.whereIn('parents:roots.type', pageTypes);
					q.whereIn('parents.type', standalones);
					q.where('parents.standalone', true);
					if (ids.length) q.whereNotIn('parents:roots.id', ids);
				});
			});
		const [items, count] = await Promise.all([
			q.limit(limit).offset(offset),
			q.resultSize()
		]);
		return {
			items,
			count,
			offset,
			limit
		};
	}
	static referrers = {
		title: 'List referrers',
		$private: true,
		$action: 'read',
		properties: {
			ids: {
				title: 'Excluding ids',
				type: 'array',
				items: {
					type: 'string',
					format: 'id'
				}
			},
			url: {
				title: 'Url',
				type: 'string',
				format: 'pathname'
			},
			limit: {
				title: 'Limit',
				type: 'integer',
				minimum: 0,
				maximum: 1000,
				default: 10
			},
			offset: {
				title: 'Offset',
				type: 'integer',
				default: 0
			}
		}
	};


	async change({
		site, trx, ref, fun, raw, Block, Href
	}, { from, to }) {
		if (from == to) return; // hum
		for (const [type, list] of Object.entries(site.$pkg.hrefs)) {
			for (const desc of list) {
				const key = 'block.data:' + desc.path;
				const field = ref(key).castText();
				// this is a fake query not part of trx
				const args = field._createRawArgs(Block.query());

				await site.$relatedQuery('children', trx)
					.where('block.type', type)
					.where(q => {
						// use fn.starts_with
						q.where(fun('starts_with', field, `${from}/`));
						q.orWhere(field, from);
					})
					.patch({
						type,
						[key]: raw(`overlay(${args[0]} placing ? from 1 for ${from.length})`, [
							args[1],
							to
						])
					});
			}
		}
		const q = Href.query(trx).where('_parent_id', site._id)
			.where(q => {
				q.where(fun('starts_with', ref('url').castText(), `${from}/`));
				q.orWhere('url', from);
			}).patch({
				url: raw(`overlay(url placing ? from 1 for ${from.length})`, [to])
			});
		await q;
	}
	static change = {
		title: 'Change all',
		$private: true,
		properties: {
			from: {
				title: 'From',
				type: 'string',
				format: 'pathname'
			},
			to: {
				title: 'To',
				type: 'string',
				format: 'pathname'
			}
		}
	};

	async collect(req, data) {
		const { site, trx } = req;
		const { hrefs } = site.$pkg;
		const qList = q => {
			const urlQueries = [];
			for (const [type, list] of Object.entries(hrefs)) {
				if (data.types.length && !list.some(desc => {
					return desc.types.some(type => {
						return data.types.includes(type);
					});
				})) {
					continue;
				}
				for (const desc of list) {
					const bq = site.$modelClass.query(trx).from('blocks')
						.where('blocks.type', type)
						.whereNotNull(req.ref(`blocks.data:${desc.path}`));
					if (desc.array) {
						bq.select(req.raw("jsonb_array_elements_text(??) AS url", [
							req.ref(`blocks.data:${desc.path}`)
						]));
						bq.where(
							req.raw("jsonb_typeof(??)", [req.ref(`blocks.data:${desc.path}`)]),
							'array'
						);
					} else {
						bq.select(req.ref(`blocks.data:${desc.path}`).castText().as('url'));
					}
					urlQueries.push(bq);
				}
			}
			q.union(urlQueries, true);
		};

		const unionBlocks = q => {
			const unionList = [
				this.#collectBlockUrls(req, data, 0)
			];
			if (data.content) {
				unionList.push(this.#collectBlockUrls(req, data, 1));
				unionList.push(this.#collectBlockUrls(req, data, 2));
			}
			q.union(unionList, true);
		};
		const q = site.$relatedQuery('hrefs', trx)
			.with('blocks', unionBlocks)
			.with('list', qList)
			.join('list', 'href.url', 'list.url');
		if (data.asMap) {
			let meta = "jsonb_set(href.meta, '{mime}', to_jsonb(href.mime))";
			meta = `jsonb_set(${meta}, '{title}', to_jsonb(href.title))`;
			if (data.preview) {
				meta = `jsonb_set(${meta}, '{preview}', to_jsonb(href.preview))`;
			}
			q.select(req.raw(`json_object_agg(
				href.url,
				${meta}
				ORDER BY href.url
			) AS hrefs`));
			const [{ hrefs }] = await q;
			return hrefs ?? {};
		} else {
			q.columns().orderBy('href.url');
			return q;
		}
	}

	static collect = {
		title: 'Collect all',
		$private: true,
		$action: 'read',
		properties: {
			ids: {
				title: 'Select root blocks by id',
				type: 'array',
				items: {
					type: "string",
					format: 'id'
				},
				nullable: true
			},
			asMap: {
				title: 'Return map of url: rows',
				type: 'boolean',
				default: false
			},
			content: {
				title: 'Within contents',
				type: 'boolean',
				default: false
			},
			preview: {
				title: 'Preview',
				description: 'Include img tag',
				type: 'boolean',
				default: false
			},
			types: {
				title: 'Types',
				description: 'Defaults to all types',
				type: 'array',
				items: {
					type: 'string'
				},
				default: []
			}
		}
	};

	#collectBlockUrls({ site, trx }, data, level) {
		const { hrefs } = site.$pkg;
		const types = Object.keys(hrefs);
		const table = ['root', 'root:block', 'root:shared:block'][level];

		const blockRelation = {
			$relation: 'children',
			$modify: [(q) => {
				q.whereIn('type', types);
			}]
		};
		const rel = {
			root: {
				$relation: 'children',
				$modify: [(q) => {
					q.where('standalone', true);
					if (data.ids?.length) q.whereIn('id', data.ids);
				}]
			}
		};
		if (level == 1) {
			rel.root.block = blockRelation;
		}
		if (level == 2) {
			rel.root.shared = {
				$relation: 'children',
				block: blockRelation,
				$modify: [(q) => {
					q.where('standalone', true);
				}]
			};
			delete rel.root.block;
		}
		return site.$modelClass.query(trx)
			.select(`${table}._id`, `${table}.id`, `${table}.type`, `${table}.data`)
			.from('block').where('block._id', site._id).joinRelated(rel);
	}

	async reinspect(req, data) {
		const { site, trx } = req;
		const { hrefs, pages } = site.$pkg;
		const fhrefs = {};
		for (const [type, list] of Object.entries(hrefs)) {
			if (data.block != type) continue;
			const flist = list.filter(desc => desc.types.includes(data.href));
			if (pages.has(type)) flist.push({
				path: 'url',
				types: ['link']
			});
			if (flist.length) fhrefs[type] = flist;
		}
		if (Object.keys(fhrefs).length === 0) {
			throw new HttpError.BadRequest(`No href types matching: ${data.block}/${data.href}`);
		}

		const rows = await site.$modelClass.query(trx).columns().from(
			site.$relatedQuery('children', trx).select('block._id')
				.whereIn('block.type', Object.keys(fhrefs))
				.leftOuterJoin('href', function () {
					this.on('href._parent_id', site._id);
					this.on(function () {
						for (const [type, list] of Object.entries(fhrefs)) {
							this.orOn(function () {
								this.on('block.type', req.val(type));
								this.on(function () {
									for (const desc of list) {
										if (desc.array) {
											this.orOn(req.ref(`data:${desc.path}`).from('block'), '@>', req.ref('href.url').castJson());
										} else {
											this.orOn('href.url', req.ref(`data:${desc.path}`).from('block').castText());
										}
									}
								});
							});
						}
					});
				})
				.groupBy('block._id')
				.count({ count: 'href.*' })
				.as('sub')
		).join('block', 'block._id', 'sub._id')
			.where('sub.count', 0);
		const urls = [];
		let ignored = 0;
		for (const row of rows) {
			for (const desc of fhrefs[row.type]) {
				const url = jsonPath.get(row.data, desc.path);
				if (url && !urls.includes(url) && !url.startsWith('/.well-known/')) {
					urls.push(url);
				} else {
					ignored++;
				}
			}
		}
		const list = await Promise.all(urls.map(url => req.run('href.add', { url })));
		return {
			ignored,
			blocks: rows.length,
			added: list.length
		};
	}
	static reinspect = {
		title: 'Reinspect many',
		$private: true,
		$action: 'write',
		required: ['block', 'href'],
		properties: {
			block: {
				title: 'Block type',
				type: 'string',
				format: 'name'
			},
			href: {
				title: 'Href type',
				description: 'link, image, video, file, embed, audio, archive',
				type: 'string',
				format: 'name'
			}
		}
	};

	async inspect(req, { url }) {
		return this.app.inspector.get(req, { url });
	}
	static inspect = {
		title: 'Inspect',
		$private: true,
		$action: 'read',
		required: ['url'],
		properties: {
			url: {
				title: 'Address',
				type: 'string',
				format: 'uri'
			}
		}
	};

	async gc(req, data) {
		const collected = await req.run('href.collect', { content: true, asMap: true });
		const items = await req.Href.query(req.trx).columns().whereSite(req.site.id);
		const list = [];
		for (const item of items) {
			if (!(item.url in collected)) {
				const { updated_at } = item;
				const now = Date.now();
				const expired = data.ttl * 3600 * 24 * 1000 + Date.parse(updated_at);
				if (now < expired) {
					continue;
				}
				list.push(item.url);
				const filePath = this.app.statics.urlToPath(req, item.url);
				if (filePath) await fs.unlink(filePath);
				const { count } = await req.run('href.del', { url: item.url });
				if (count != 1) {
					console.warn(count, "href have been removed with url:", item.url);
				}
			}
		}
		return { removals: list };
	}
	static gc = {
		title: 'Garbage collect',
		description: 'Delete orphaned hrefs',
		$private: true,
		$action: 'write',
		properties: {
			ttl: {
				title: 'TTL',
				description: 'days',
				type: 'integer',
				default: 31
			}
		}
	};
};

