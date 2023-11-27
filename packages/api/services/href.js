const Path = require('node:path');
const jsonPath = require.lazy('@kapouer/path');

module.exports = class HrefService {
	static name = 'href';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	apiRoutes(app, server) {
		server.get("/.api/hrefs", app.auth.lock('webmaster'), async (req, res) => {
			const obj = await req.run('href.search', req.query);
			res.send(obj);
		});
		server.get("/.api/href", app.auth.lock('user'), async (req, res) => {
			const obj = await req.run('href.find', req.query);
			res.send(obj);
		});
		server.post("/.api/href", app.cache.tag('data-:site'), app.auth.lock('user'), async (req, res) => {
			const obj = await req.run('href.add', req.body);
			res.send(obj);
		});
		server.delete("/.api/href", app.cache.tag('data-:site'), app.auth.lock('webmaster'), async (req, res) => {
			const obj = await req.run('href.del', req.query);
			res.send(obj);
		});
	}

	get({ Href, site, trx }, data) {
		return Href.query(trx).select('href._id')
			.whereSite(site.id)
			.where('href.url', data.url).first();
	}

	async find({ Href, site, trx }, data) {
		const item = await Href.query(trx).columns()
			.whereSite(site.id)
			.where('href.url', data.url).first().throwIfNotFound();
		return { item };
	}
	static find = {
		title: 'Get URL metadata',
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
		const { Href, site, trx } = req;
		// TODO use .page() and/or .resultSize() see objection doc
		const q = Href.query(trx).columns().whereSite(site.id);

		if (data.type) {
			q.whereIn('href.type', data.type);
		}
		if (data.maxSize) {
			q.where(req.ref('href.meta:size'), '<=', data.maxSize);
		}
		if (data.maxWidth) {
			q.where(req.ref('href.meta:width'), '<=', data.maxWidth);
		}
		if (data.maxHeight) {
			q.where(req.ref('href.meta:height'), '<=', data.maxHeight);
		}
		if (data.offset < 0) {
			data.limit += data.offset;
			data.offset = 0;
			if (data.limit < 0) {
				throw new HttpError.BadRequest("limit cannot be negative");
			}
		}
		q.offset(data.offset).limit(data.limit);

		let items = [];

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
						type: ["heading", "link"],
						offset: data.offset,
						limit: data.limit,
						data: {
							'id:start': hash
						}
					});
					for (const item of obj.items) {
						items.push({
							...href,
							title: `${href.title} #${item.data.id}`,
							url: `${href.url}#${item.data.id}`
						});
					}
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
			items = await q;
		} else {
			q.orderBy('updated_at', 'desc');
			items = await q;
		}
		return {
			items,
			offset: data.offset,
			limit: data.limit
		};
	}

	static search = {
		title: 'Search URL metadata',
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
		} catch(err) {
			const item = await this.#add(req, data);
			return { item };
		}
	}

	async #add(req, data) {
		const { site, trx, Href } = req;
		let local = false;
		const siteUrl = site.$url ?? new URL(`https://${site.id}.localhost.localdomain`);
		const pageUrl = new URL(data.url, siteUrl);
		if (siteUrl.hostname == pageUrl.hostname) {
			data.url = pageUrl.pathname + pageUrl.search;
			local = true;
		}

		let result;
		if (local && !pageUrl.pathname.startsWith('/.')) {
			// consider it's a page
			const { item } = await req.run('block.find', {
				type: Array.from(site.$pkg.pages),
				content: 'title',
				data: {
					url: pageUrl.pathname
				}
			});
			if (!item) {
				throw new HttpError.NotFound("inspect cannot find block: " + pageUrl.pathname);
			}
			result = {
				mime: 'text/html; charset=utf-8',
				type: 'link',
				title: item.content.title,
				site: null,
				pathname: pageUrl.pathname,
				url: pageUrl.pathname + pageUrl.search
			};
		} else {
			result = await this.inspect(req, { url: data.url, local });
		}
		if (!local && result.url != data.url) {
			result.canonical = result.url;
			result.url = data.url;
			result.pathname = pageUrl.pathname;
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
		title: 'Add URL',
		$action: 'write',
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	async save(req, data) {
		const { Href, site, trx } = req;
		const href = await this.get(req, data)
			.throwIfNotFound()
			.forUpdate();
		return site.$relatedQuery('hrefs', trx)
			.where('_id', href._id)
			.first()
			.patchObject({
				title: data.title
			})
			.returning(Href.columns);
	}
	static save = {
		title: 'Change href title',
		description: 'This avoids reinspecting the full url',
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
		title: 'Delete URL',
		$action: 'write',
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
		const hrefs = site.$hrefs;
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
		const q = site.$relatedQuery('children', trx)
			.with('list', qList)
			.join('list', 'list.id', 'block.id')
			.distinct('parents.id', 'parents.type')
			.where(ref('block.data:url').castText(), url)
			.joinRelated('parents')
			.whereNot('parents.type', 'site')
			.whereNotIn('block.type', Array.from(site.$pkg.pages))
			.where(q => {
				if (ids.length) q.whereNotIn('parents.id', ids);
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
		title: 'Referrers',
		$lock: true,
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
		for (const [type, list] of Object.entries(site.$hrefs)) {
			for (const desc of list) {
				if (desc.types.some(type => {
					// just a bug waiting to happen
					// site.$hrefs should omit unmutable hrefs
					return ['image', 'video', 'audio', 'svg'].includes(type);
				})) continue;
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
						[key]: raw(
							`overlay(${args[0]} placing ? from 1 for ${from.length})`,
							args[1],
							to
						)
					});
			}
		}
		await Href.query(trx).where('_parent_id', site._id)
			.where('type', 'link')
			.where(q => {
				q.where(fun('starts_with', 'url', `${from}/`));
				q.orWhere('url', from);
			}).patch({
				url: raw(`overlay(url placing ? from 1 for ${from.length})`, to)
			});
	}
	static change = {
		title: 'Change',
		$lock: true,
		properties: {
			from: {
				title: 'From Url',
				type: 'string',
				format: 'pathname'
			},
			to: {
				title: 'To Url',
				type: 'string',
				format: 'pathname'
			}
		}
	};

	collect(req, data) {
		const { site, trx } = req;
		const hrefs = site.$hrefs;
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
			q.select(req.raw(`jsonb_object_agg(
				href.url,
				${meta}
			) AS hrefs`));
		} else {
			q.columns();
		}
		return q;
	}

	static collect = {
		title: 'Collect hrefs',
		$lock: true,
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
		const hrefs = site.$hrefs;
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
					if (data.ids.length) q.whereIn('id', data.ids);
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
		const hrefs = site.$hrefs;
		const fhrefs = {};
		for (const [type, list] of Object.entries(hrefs)) {
			if (data.block != type) continue;
			const flist = list.filter(desc => desc.types.includes(data.href));
			if (site.$pkg.pages.has(type)) flist.push({
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
		const list = await Promise.all(urls.map(url => {
			return req.run('href.add', { url });
		}));
		return {
			ignored,
			blocks: rows.length,
			added: list.length
		};
	}
	static reinspect = {
		title: 'Batch reinspection',
		$lock: true,
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

	async inspect({ site }, { url, local }) {
		let fileUrl = url;
		if (local === undefined) {
			local = url.startsWith(`/.uploads/`);
		}
		if (local) {
			fileUrl = url.replace(`/.uploads/`, `uploads/${site.id}/`);
			fileUrl = "file://" + Path.join(this.app.dirs.data, fileUrl);
		}
		const obj = await this.app.inspector.get({
			url: fileUrl,
			local: local
		});
		if (local) {
			obj.site = null;
			obj.url = url;
		}
		return obj;
	}
	static inspect = {
		title: 'Inspect',
		$lock: true,
		$action: 'read',
		required: ['url'],
		properties: {
			url: {
				title: 'URL',
				type: 'string'
			},
			local: {
				title: 'Is local',
				type: 'boolean'
			}
		}
	};
};



exports.gc = function ({ trx }, days) {
	return Promise.resolve([]);
	// TODO use sites schemas to known which paths to check:
	// for example, data.url comes from elements.image.properties.url.input.name == "href"

	// TODO href.site IS NULL used to be p.data->>'domain' = href.site
	// BOTH are wrong since they won't touch external links...
	// TODO the outer join on url is also a bit wrong since it does not use href._parent !!!
	/*
	return req.raw(`DELETE FROM href USING (
		SELECT count(block.*) AS count, href._id FROM href
		LEFT OUTER JOIN block ON (block.data->>'url' = href.url)
		LEFT JOIN relation AS r ON (r.child_id = block._id)
		LEFT JOIN block AS p ON (p._id = r.parent_id AND p.type='site' AND href.site IS NULL)
		WHERE extract('day' from now() - href.updated_at) >= ?
		GROUP BY href._id
	) AS usage WHERE usage.count = 0 AND href._id = usage._id
	RETURNING href.type, href.pathname, p.id AS site`, [
		days
	]).then(function(result) {
		return result.rows;
	});
	*/
};

