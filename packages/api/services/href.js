const { promises: fs } = require('node:fs');


module.exports = class HrefService {
	static name = 'href';

	constructor(app) {
		this.app = app;
	}

	apiRoutes(router) {
		router.read("/href/search", 'href.search', ['webmaster']);
		router.read("/href/find", 'href.find', ['user']);
		router.write("/href/add", 'href.add', ['webmaster']);
	}

	get({ site, sql: { trx, Href } }, data) {
		return Href.query(trx).select('href._id')
			.whereSite(site.id)
			.where('href.url', data.url).first();
	}

	async find({ site, sql: { trx, Href } }, data) {
		const href = await Href.query(trx).columns()
			.whereSite(site.id)
			.where('href.url', data.url).first().throwIfNotFound();
		return { href };
	}
	static find = {
		title: 'Find',
		$action: 'read',
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	async search(req, data) {
		const { site, sql: { ref, trx, Href } } = req;
		const q = Href.query(trx).columns().whereSite(site.id);
		const { type, maxSize, maxWidth, maxHeight } = data;
		let { offset, limit } = data;

		if (type) {
			q.whereIn('href.type', type);
		}
		if (maxSize) {
			q.where(ref('href.meta:size'), '<=', maxSize);
		}
		if (maxWidth) {
			q.where(ref('href.meta:width'), '<=', maxWidth);
		}
		if (maxHeight) {
			q.where(ref('href.meta:height'), '<=', maxHeight);
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
							type: Array.from(site.$pkg.groups.page),
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
				q.from(req.sql.raw("to_tsquery('unaccent', ?) AS query, ??", [data.text + ':*', 'href']));
			} else {
				q.from(req.sql.raw("websearch_to_tsquery('unaccent', href_tsv_url(?)) AS query, ??", [data.text, 'href']));
			}
			q.whereRaw('query @@ href.tsv');
			q.orderByRaw('ts_rank(href.tsv, query) DESC');
			q.orderBy(ref('href.url'));
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
		} catch {
			const href = await this.#add(req, data);
			return { href };
		}
	}

	async #add(req, data) {
		const { site, sql: { trx, Href }, $url } = req;
		let local = false;
		const siteUrl = $url ?? new URL(`https://${site.id}.localhost.localdomain`);
		const fullUrl = new URL(data.url, siteUrl);
		if (siteUrl.hostname == fullUrl.hostname) {
			data.url = fullUrl.pathname + fullUrl.search;
			local = true;
		}

		let result;
		if (local && !fullUrl.pathname.startsWith('/@')) {
			const { item } = await req.run('block.find', {
				type: Array.from(site.$pkg.groups.page),
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
				url: fullUrl.pathname + fullUrl.search
			};
		} else {
			result = await this.inspect(req, { url: data.url });
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
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	async save(req, data) {
		const { site, sql: { trx, Href } } = req;
		const { url } = data;
		const copy = { ...data };
		delete copy.url;
		const { _id } = await this.get(req, { url })
			.throwIfNotFound()
			.forUpdate();
		const href = await site.$relatedQuery('hrefs', trx)
			.where('_id', _id)
			.first()
			.patchObject(copy)
			.returning(Href.columns);
		return { href };
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
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	async referrers(req, { ids = [], url, limit, offset }) {
		const { site, sql: { ref, trx, fun } } = req;
		const { hrefs, standalones, groups } = site.$pkg;
		const altRefs = site.$relatedQuery('children', trx).where(wq => {
			for (const [type, list] of Object.entries(hrefs)) {
				if (groups.page.has(type)) continue;
				for (const desc of list) {
					wq.orWhere(q => {
						q.where('block.type', type);
						q.where(fun('jsonb_path_exists', ref('block.data'), desc.path + ` ? (@ == "${url}")`));
					});
				}
			}
		});
		const pageTypes = Array.from(groups.page);
		const q = altRefs
			.distinct('parents.id', 'parents.type')
			.joinRelated('parents.[parents as roots]')
			.whereNot('parents.type', 'site')
			.where(q => {
				q.where(q => {
					q.where('parents:roots.type', 'site');
					q.whereIn('parents.type', pageTypes);
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
		site, sql: { trx, ref, fun, raw, Block, Href }
	}, { from, to, limit }) {
		if (!from || !to || from == "/" || to == "/") {
			// this shouldn't happen
			throw new HttpError.BadRequest("from, to must not be empty or /");
		}
		if (from == to) {
			// nothing to do but ok
			return;
		}
		const fromLen = from.length;
		for (const [type, list] of Object.entries(site.$pkg.hrefs)) {
			for (const desc of list) {
				if (limit && !desc.types.includes(limit)) {
					continue;
				}
				if (desc.path.includes('[*]')) {
					console.info("href.change does not support nested path", desc.path);
					continue;
				}
				const keyAcc = desc.path.substring(1)
					.replace(/\.(\w+)/g, (m, label) => {
						return `['${label}']`;
					});

				const obj = {
					fromDir: `${from}/`,
					to: `${to}/`,
					from: from
				};
				const qi = Block.query(trx).knex().raw(`WITH blocks AS (
					SELECT block._id, block.data FROM block, relation
					WHERE block._id = relation.child_id
					AND relation.parent_id = :site_id
					AND block.type = :type
					AND jsonb_path_exists(data, '${desc.path} \\? ((@ == $from) || (@ starts with $fromDir && !(@ starts with $to)))', '${JSON.stringify(obj)}')
				), iters AS (
					SELECT _id, to_jsonb(
						OVERLAY(
							(jsonb_build_array(list.href))->>0
							PLACING :to FROM 1 FOR ${fromLen}
						)
					) AS href
					FROM blocks, jsonb_path_query(blocks.data, '${desc.path}') AS list(href)
				)
				UPDATE block
					SET data${keyAcc} = iters.href
					FROM iters WHERE block._id = iters._id`, {
					to, type,
					site_id: site._id
				});
				await qi;
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
		$action: 'write',
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
			},
			limit: {
				title: 'Limit to type',
				description: 'Optimization to avoid requesting all schemas',
				type: 'string',
				format: 'name'
			}
		}
	};

	async collect(req, data) {
		const { site, sql: { trx } } = req;
		const qList = this.#collectUrls(req, data);

		const unionBlocks = q => {
			const unionList = [
				this.#collectBlocks(req, data, 0)
			];
			if (data.content) {
				unionList.push(this.#collectBlocks(req, data, 1));
				unionList.push(this.#collectBlocks(req, data, 2));
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
			q.select(req.sql.raw(`json_object_agg(
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

	#collectUrls(req, data) {
		const { site, sql: { ref, fun, raw, trx } } = req;
		const { hrefs } = site.$pkg;
		const qList = q => {
			const urlQueries = [];
			for (const [type, list] of Object.entries(hrefs)) {
				if (data.type && type != data.type) continue;
				if (data.types.length && !list.some(desc => {
					return desc.types.some(type => {
						return data.types.includes(type);
					});
				})) {
					continue;
				}
				for (const desc of list) {
					const bq = site.$modelClass.query(trx)
						.from(raw('blocks, jsonb_path_query(blocks.data, ?)', desc.path))
						.select(fun('json_value', ref('jsonb_path_query'), '$').as('url'))
						.where('blocks.type', type)
						.where(fun('jsonb_path_exists', ref('blocks.data'), desc.path));
					urlQueries.push(bq);
				}
			}
			if (!urlQueries.length) {
				throw new HttpError.BadRequest(`block type ${data.type} does not have href types ${data.types}`);
			}
			q.union(urlQueries, true); // returns list of unique url
		};

		return qList;
	}

	#collectBlocks({ site, sql: { trx } }, data, level) {
		const types = Object.keys(site.$pkg.hrefs);
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
		const { site, sql: { trx } } = req;
		const qList = this.#collectUrls(req, { type: data.block, types: data.href });
		const rows = await site.$relatedQuery('hrefs', trx)
			.with('blocks', q => {
				q.union([site.$query(trx), site.$relatedQuery('children', trx)], true);
			})
			.with('list', qList)
			.join('list', 'href.url', 'list.url').orderBy('href.url');
		const list = await Promise.all(rows.map(item => req.run('href.add', {
			url: item.url
		})));
		return {
			count: list.length
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
		const items = await req.sql.Href.query(req.sql.trx).columns().whereSite(req.site.id);
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
				const filePath = req.call('statics.path', { url: item.url });
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

