const Path = require('node:path');
const { ref, raw, val } = require('objection');
const jsonPath = require.lazy('@kapouer/path');

module.exports = class HrefService {
	static name = 'href';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	apiRoutes(app, server) {
		server.get("/.api/hrefs", app.auth.lock('webmaster'), async (req, res) => {
			const href = await req.run('href.search', req.query);
			res.send(href);
		});
		server.post("/.api/href", app.auth.lock('webmaster'), async (req, res) => {
			const href = await req.run('href.add', req.body);
			res.send(href);
		});
		server.delete("/.api/href", app.auth.lock('webmaster'), async (req, res) => {
			const href = await req.run('href.del', req.query);
			res.send(href);
		});
	}

	get({ Href, site, trx }, data) {
		return Href.query(trx).select('href._id')
			.whereSite(site.id)
			.where('href.url', data.url).first();
	}
	static get = {
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
		const q = Href.query(trx).select().whereSite(site.id);

		if (data.type) {
			q.whereIn('href.type', data.type);
		}
		if (data.maxSize) {
			q.where(ref('href.meta:size'), '<=', data.maxSize);
		}
		if (data.maxWidth) {
			q.where(ref('href.meta:width'), '<=', data.maxWidth);
		}
		if (data.maxHeight) {
			q.where(ref('href.meta:height'), '<=', data.maxHeight);
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
							type: site.$pkg.pages,
							data: {
								url: url
							}
						},
						type: "heading",
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
				q.from(raw("to_tsquery('unaccent', ?) AS query, ??", [data.text + ':*', 'href']));
			} else {
				q.from(raw("websearch_to_tsquery('unaccent', href_tsv_url(?)) AS query, ??", [data.text, 'href']));
			}
			q.whereRaw('query @@ href.tsv');
			q.orderByRaw('ts_rank(href.tsv, query) DESC');
			q.orderBy(ref('href.url'));
			q.where('href.visible', true);
			q.orderBy('updated_at', 'desc');
			items = await q;
		} else {
			q.where('href.visible', true);
			q.orderBy('updated_at', 'desc');
			items = await q;
		}
		return {
			data: items,
			offset: data.offset,
			limit: data.limit
		};
	}

	static search = {
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
		const obj = await req.run('href.search', data);
		if (obj.data.length > 0) {
			return obj.data[0];
		} else {
			return this.#blindAdd(req, data);
		}
	}

	async #blindAdd(req, data) {
		const { site, trx, Href } = req;
		let local = false;
		const siteUrl = site.url ?? new URL(`https://${site.id}.localhost.localdomain`);
		const pageUrl = new URL(data.url, siteUrl);
		if (siteUrl.hostname == pageUrl.hostname) {
			data.url = pageUrl.pathname + pageUrl.search;
			local = true;
		}

		let result;
		if (local && !pageUrl.pathname.startsWith('/.')) {
			// consider it's a page
			try {
				const { item } = await req.run('block.find', {
					type: site.$pkg.pages,
					data: {
						url: pageUrl.pathname
					}
				});
				result = {
					mime: 'text/html; charset=utf-8',
					type: 'link',
					title: item.data && item.data.title || "",
					site: null,
					pathname: pageUrl.pathname,
					url: pageUrl.pathname + pageUrl.search
				};
			} catch (err) {
				if (err.statusCode == 404) {
					console.error("reinspect cannot find block", data);
				}
				throw err;
			}
		} else {
			result = await this.#inspect(req, { url: data.url, local });
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
		$action: 'add',
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
		$action: 'save',
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
		const { site, trx } = req;
		const href = await this.get(req, data).throwIfNotFound();
		await site.$relatedQuery('hrefs', trx).patchObject({
			visible: false
		}).where('_id', href._id);
		href.visible = false;
		return href;
	}
	static del = {
		$action: 'del',
		required: ['url'],
		properties: {
			url: {
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	collect(req, data) {
		const { site, trx } = req;
		const hrefs = site.$hrefs;
		const qList = q => {
			const urlQueries = [];
			for (const [type, list] of Object.entries(hrefs)) {
				if (!list.some(desc => {
					return desc.types.some(type => {
						return ['image', 'video', 'audio', 'svg'].includes(type);
					});
				})) continue;
				for (const desc of list) {
					const bq = site.$modelClass.query(trx).from('blocks')
						.where('blocks.type', type)
						.whereNotNull(ref(`blocks.data:${desc.path}`));
					if (desc.array) {
						bq.select(raw("jsonb_array_elements_text(??) AS url", [
							ref(`blocks.data:${desc.path}`)
						]));
						bq.where(
							raw("jsonb_typeof(??)", [ref(`blocks.data:${desc.path}`)]),
							'array'
						);
					} else {
						bq.select(ref(`blocks.data:${desc.path}`).castText().as('url'));
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
			if (data.preview) {
				meta = `jsonb_set(${meta}, '{preview}', to_jsonb(href.preview))`;
			}
			q.select(raw(`jsonb_object_agg(
				href.url,
				${meta}
			) AS hrefs`));
		} else {
			q.select();
		}
		return q;
	}

	static collect = {
		title: 'Collect hrefs',
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
				title: 'Collect hrefs in blocks contents',
				type: 'boolean',
				default: false
			},
			preview: {
				title: 'Preview',
				description: 'Include img tag',
				type: 'boolean',
				default: false
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
			if (data.type && type != data.type) continue;
			const flist = list.filter(desc => {
				return !data.types.length || desc.types.some(type => {
					return data.types.includes(type);
				});
			});
			if (site.$pkg.pages.includes(type)) flist.push({
				path: 'url',
				types: ['link']
			});
			if (flist.length) fhrefs[type] = flist;
		}
		if (Object.keys(fhrefs).length === 0) {
			throw new Error(`No types selected: ${data.types.join(',')}`);
		}

		const rows = site.$modelClass.query(trx).select().from(
			site.$relatedQuery('children', trx).select('block._id')
				.whereIn('block.type', Object.keys(fhrefs))
				.leftOuterJoin('href', function () {
					this.on('href._parent_id', site._id);
					this.on(function () {
						for (const [type, list] of Object.entries(fhrefs)) {
							this.orOn(function () {
								this.on('block.type', val(type));
								this.on(function () {
									for (const desc of list) {
										if (desc.array) {
											this.orOn(ref(`data:${desc.path}`).from('block'), '@>', ref('href.url').castJson());
										} else {
											this.orOn('href.url', ref(`data:${desc.path}`).from('block').castText());
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
		for (const row of rows) {
			for (const desc of fhrefs[row.type]) {
				const url = jsonPath.get(row.data, desc.path);
				if (url && !urls.includes(url) && !url.startsWith('/.well-known/')) {
					urls.push(url);
				}
			}
		}
		const list = await Promise.all(urls.map(url => {
			return req.run('href.add', { url });
		}));
		return {
			missings: rows.length,
			added: list.length
		};
	}
	static reinspect = {
		$action: 'write',
		properties: {
			all: {
				title: 'All',
				type: 'boolean',
				default: false
			},
			type: {
				title: 'Type',
				nullable: true,
				type: 'string'
			},
			types: {
				title: 'Href Types',
				default: [],
				type: 'array',
				items: {
					type: 'string'
				}
			}
		}
	};

	async #inspect({ site }, { url, local }) {
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
};



exports.gc = function ({ trx }, days) {
	return Promise.resolve([]);
	// TODO use sites schemas to known which paths to check:
	// for example, data.url comes from elements.image.properties.url.input.name == "href"

	// TODO href.site IS NULL used to be p.data->>'domain' = href.site
	// BOTH are wrong since they won't touch external links...
	// TODO the outer join on url is also a bit wrong since it does not use href._parent !!!
	/*
	return trx.raw(`DELETE FROM href USING (
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

