const Path = require('path');
const { ref, raw, val } = require('objection');
const jsonPath = require.lazy('@kapouer/path');

module.exports = class HrefService {
	static name = 'href';

	service(app, server) {
		server.get("/.api/hrefs", app.auth.lock('webmaster'), async (req, res) => {
			const href = await app.run('href.search', req, req.query);
			res.send(href);
		});
		server.post("/.api/href", app.auth.lock('webmaster'), async (req, res) => {
			const href = app.run('href.add', req, req.body);
			res.send(href);
		});
		server.delete("/.api/href", app.auth.lock('webmaster'), async (req, res) => {
			const href = app.run('href.del', req, req.query);
			res.send(href);
		});
	}

	async get({ Href, site, trx }, data) {
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
		const { Href, app, site, trx } = req;
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
		q.offset(data.offset).limit(data.limit);

		let items = [];

		if (data.url) {
			const [url, hash] = data.url.split('#');
			q.where('url', url);
			if (url.startsWith('/') && hash != null) {
				const href = await q.first();
				if (href) {
					const obj = await app.run('block.search', req, {
						parent: {
							type: site.$pages,
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
						items.push(Object.assign({}, href, {
							title: href.title + ' #' + item.data.id,
							url: href.url + '#' + item.data.id
						}));
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
				minimum: 0,
				default: 0
			}
		}
	};

	async add(req, data) {
		const obj = await req.app.run('href.search', req, data);
		if (obj.data.length > 0) {
			return obj.data[0];
		} else {
			return this.#blindAdd(req, data);
		}
	}

	async #blindAdd(req, data) {
		const { app, site, trx, Href } = req;
		const url = new URL(data.url, site.url);
		let local = false;
		if (site.url.hostname == url.hostname) {
			data.url = url.pathname + url.search;
			local = true;
		}

		let result;

		if (local && !data.url.startsWith('/.')) {
			// consider it's a page
			try {
				const { item } = await app.run('block.find', req, {
					type: site.$pages,
					data: {
						url: url.pathname
					}
				});
				result = {
					mime: 'text/html; charset=utf-8',
					type: 'link',
					title: item.data && item.data.title || "",
					site: null,
					pathname: url.pathname,
					url: url.pathname + url.search
				};
			} catch (err) {
				if (err.statusCode == 404) {
					console.error("reinspect cannot find block", data);
				}
				throw err;
			}
		} else {
			result = await callInspector(req, { url: data.url, local });
		}
		if (!local && result.url != data.url) {
			result.canonical = result.url;
			result.url = data.url;
			result.pathname = url.pathname;
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

	async collect(req, data) {
		const { Block, Href, site, trx } = req;
		const hrefs = site.$model.hrefs;
		const qList = q => {
			const urlQueries = [];
			for (const [type, list] of Object.entries(hrefs)) {
				if (!list.some((desc) => {
					return desc.types.some((type) => {
						return ['image', 'video', 'audio', 'svg'].includes(type);
					});
				})) continue;
				for (const desc of list) {
					const bq = Block.query(trx).from('blocks')
						.where('type', type)
						.whereNotNull(ref(`data:${desc.path}`));
					if (desc.array) {
						bq.select(raw("jsonb_array_elements_text(??) AS url", [
							ref(`data:${desc.path}`)
						]));
						bq.where(
							raw("jsonb_typeof(??)", [ref(`data:${desc.path}`)]),
							'array'
						);
					} else {
						bq.select(ref(`data:${desc.path}`).castText().as('url'));
					}
					urlQueries.push(bq);
				}
			}
			q.unionAll(urlQueries, true);
		};

		const qBlocks = (q) => {
			const qList = [
				collectBlockUrls({ site, trx }, data, 0)
			];
			if (data.content) {
				qList.push(collectBlockUrls({ site, trx }, data, 1));
				qList.push(collectBlockUrls({ site, trx }, data, 2));
			}
			q.unionAll(qList, true);
		};
		return Href.query(trx)
			.with('blocks', qBlocks)
			.with('list', qList)
			.select(raw(`jsonb_object_agg(
					href.url,
					jsonb_set(href.meta, '{mime}', to_jsonb(href.mime))
				) AS hrefs`))
			.where('href._parent_id', site._id)
			.join('list', 'href.url', 'list.url');
	}

	async reinspect(req, data) {
		const { app, site, trx, Block } = req;
		const hrefs = site.$model.hrefs;
		const fhrefs = {};
		for (const [type, list] of Object.entries(hrefs)) {
			if (data.type && type != data.type) continue;
			const flist = list.filter((desc) => {
				return !data.types.length || desc.types.some((type) => {
					return data.types.includes(type);
				});
			});
			if (site.$pages.includes(type)) flist.push({
				path: 'url',
				types: ['link']
			});
			if (flist.length) fhrefs[type] = flist;
		}
		if (Object.keys(fhrefs).length === 0) {
			throw new Error(`No types selected: ${data.types.join(',')}`);
		}

		const rows = Block.query(trx).select().from(
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
		const list = await Promise.all(urls.map((url) => {
			return app.run('href.add', req, { url });
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
};


function collectBlockUrls({ Block, site, trx }, data, level) {
	const hrefs = site.$model.hrefs;
	const types = Object.keys(hrefs);
	const table = ['root', 'root:block', 'root:shared:block'][level];

	const qRoot = Block.query(trx)
		.select(table + '.*')
		.where('block._id', site._id);
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
	qRoot.joinRelated(rel);
	if (data.url) {
		qRoot.whereIn('root.type', site.$pages)
			.where(ref('root.data:url').castText(), data.url);
	} else if (data.id != null) {
		let list = data.id;
		if (!Array.isArray(list)) list = [data.id];
		qRoot.whereIn('root.id', list);
	}
	return qRoot;
}


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



async function callInspector({ app, site }, { url, local }) {
	let fileUrl = url;
	if (local === undefined) {
		local = url.startsWith(`/.uploads/`);
	}
	if (local) {
		fileUrl = url.replace(`/.uploads/`, `uploads/${site.id}/`);
		fileUrl = "file://" + Path.join(app.dirs.data, fileUrl);
	}
	const obj = await app.inspector.get({
		url: fileUrl,
		local: local
	});
	if (local) {
		obj.site = null;
		obj.url = url;
	}
	return obj;
}
