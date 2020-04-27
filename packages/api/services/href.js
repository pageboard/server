const Path = require('path');
const URL = require('url');
const {ref, raw, val} = require('objection');
const jsonPath = require.lazy('@kapouer/path');

exports = module.exports = function(opt) {
	this.opt = opt;
	return {
		name: 'href',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/hrefs", All.auth.lock('webmaster'), function(req, res, next) {
		All.run('href.search', req, req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.post("/.api/href", All.auth.lock('webmaster'), function(req, res, next) {
		All.run('href.add', req, req.body).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.delete("/.api/href", All.auth.lock('webmaster'), function(req, res, next) {
		All.run('href.del', req, req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
}

exports.get = function({site, trx}, data) {
	return All.api.Href.query(trx).select('href._id')
	.whereSite(site.id)
	.where('href.url', data.url).first();
};

exports.get.schema = {
	$action: 'read',
	required: ['url'],
	properties: {
		url: {
			type: 'string',
			format: 'uri-reference'
		}
	}
};

exports.search = function({site, trx}, data) {
	// TODO use .page() and/or .resultSize() see objection doc
	const Href = All.api.Href;
	let q = Href.query(trx).select().whereSite(site.id);

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

	if (data.url) {
		const [url, hash] = data.url.split('#');
		q.where('url', url);
		if (url.startsWith('/') && hash != null) {
			q = q.first().then(function(href) {
				if (!href) return [];
				return All.run('block.search', {site, trx}, {
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
				}).then(function(obj) {
					const rows = [];
					obj.items.forEach((item) => {
						rows.push(Object.assign({}, href, {
							title: href.title + ' #' + item.data.id,
							url: href.url + '#' + item.data.id
						}));
					});
					return rows;
				});
			});
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
	} else {
		q.where('href.visible', true);
		q.orderBy('updated_at', 'desc');
	}
	return q.then(function(rows) {
		return {
			data: rows,
			offset: data.offset,
			limit: data.limit
		};
	});
};

exports.search.schema = {
	$action: 'read',
	properties: {
		type: {
			type: 'array',
			items: {
				type: 'string',
				format: 'id'
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

exports.add = function(req, data) {
	return All.run('href.search', req, data).then(function(obj) {
		if (obj.data.length > 0) {
			return obj.data[0];
		} else {
			return blindAdd(req, data);
		}
	});
};

function blindAdd(req, data) {
	const {site, trx} = req;
	const Href = All.api.Href;
	const url = data.url;
	const objUrl = URL.parse(url);
	let isLocal = false;
	if (!objUrl.hostname) objUrl.hostname = site.hostname;
	if (site.hostname == objUrl.hostname) {
		data.url = objUrl.path;
		isLocal = true;
	}

	let p;

	if (isLocal && !data.url.startsWith('/.')) {
		// consider it's a page
		p = All.block.find(req, {
			type: site.$pages,
			data: {
				url: objUrl.pathname
			}
		}).catch(function(err) {
			if (err.statusCode == 404) {
				console.error("reinspect cannot find block", data);
			}
			throw err;
		}).then(function(answer) {
			let block = answer.item;
			return {
				mime: 'text/html; charset=utf-8',
				type: 'link',
				title: block.data && block.data.title || "",
				site: null,
				pathname: objUrl.pathname,
				url: objUrl.path
			};
		});
	} else {
		p = callInspector(site.id, data.url, isLocal);
	}
	return p.then(function(result) {
		if (!isLocal && result.url != data.url) {
			result.canonical = result.url;
			result.url = data.url;
			result.pathname = objUrl.pathname;
		}
		return exports.get(req, data).forUpdate().then(function(href) {
			if (!href) {
				return site.$relatedQuery('hrefs', trx).insert(result).returning(Href.columns);
			} else {
				return site.$relatedQuery('hrefs', trx).patchObject(result).where('_id', href._id)
				.first().returning(Href.columns);
			}
		});
	});
}

exports.add.schema = {
	$action: 'add',
	required: ['url'],
	properties: {
		url: {
			type: 'string',
			format: 'uri-reference'
		}
	}
};

exports.save = function(req, data) {
	const Href = All.api.Href;
	return exports.get(req, data)
	.throwIfNotFound()
	.forUpdate()
	.then(function(href) {
		return req.site.$relatedQuery('hrefs', req.trx).patchObject({
			title: data.title
		}).where('_id', href._id).first().returning(Href.columns);
	});
};

exports.save.schema = {
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

exports.del = function(req, data) {
	return exports.get(req, data).throwIfNotFound().then(function(href) {
		return req.site.$relatedQuery('hrefs', req.trx).patchObject({
			visible: false
		}).where('_id', href._id).then(function() {
			href.visible = false;
			return href;
		});
	});
};

exports.del.schema = {
	$action: 'del',
	required: ['url'],
	properties: {
		url: {
			type: 'string',
			format: 'uri-reference'
		}
	}
};

exports.collect = function({site, trx}, data={}) {
	const q = All.api.Href.query(trx)
	.select(
		raw(`jsonb_object_agg(
			href.url,
			jsonb_set(href.meta, '{mime}', to_jsonb(href.mime))
		) AS hrefs`)
	).from((builder) => {
		builder.union([
			collectHrefs({site, trx}, data, 0),
			collectHrefs({site, trx}, data, 1),
			collectHrefs({site, trx}, data, 2)
		]).as('href');
	});
	return q;
};

function collectHrefs({site, trx}, data, level) {
	let q = All.api.Block.query(trx).where('block._id', site._id)
	.select('href.url', 'href.meta', 'href.mime');
	const hrefs = site.$model.hrefs;
	const types = Object.keys(hrefs);

	const blockRelation = {
		$relation: 'children',
		$modify: [(q) => {
			q.whereIn('type', types);
		}]
	};
	const rel = {
		href: {
			$relation: 'hrefs'
		},
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
	q.joinRelated(rel);
	if (data.url) {
		q.whereIn('root.type', site.$pages)
		.where(ref('root.data:url').castText(), data.url);
	} else if (data.id != null) {
		let list = data.id;
		if (!Array.isArray(list)) list = [data.id];
		q.whereIn('root.id', list);
	}

	const table = ['root', 'root:block', 'root:shared:block'][level];
	q.where(function() {
		Object.entries(hrefs).forEach(([type, list]) => {
			if (!list.some((desc) => {
				return desc.types.some((type) => {
					return ['image', 'video', 'audio', 'svg'].includes(type);
				});
			})) return;
			this.orWhere(function() {
				this.where(table + '.type', type);
				this.where(function() {
					list.forEach((desc) => {
						if (desc.array) {
							this.orWhere(ref(`data:${desc.path}`).from(table), '@>', ref('href.url').castJson());
						} else {
							this.orWhere('href.url', ref(`data:${desc.path}`).from(table).castText());
						}
					});
				});
			});
		});
	});
	return q;
}


exports.gc = function({trx}, days) {
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

exports.reinspect = function({site, trx}, data) {
	const hrefs = site.$model.hrefs;
	const fhrefs = {};
	Object.entries(hrefs).forEach(([type, list]) => {
		if (data.type && type != data.type) return;
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
	});
	if (Object.keys(fhrefs).length === 0) {
		throw new Error(`No types selected: ${data.types.join(',')}`);
	}

	return All.api.Block.query(trx).select().from(
		site.$relatedQuery('children', trx).select('block._id')
		.whereIn('block.type', Object.keys(fhrefs))
		.leftOuterJoin('href', function() {
			this.on('href._parent_id', site._id);
			this.on(function() {
				Object.entries(fhrefs).forEach(([type, list]) => {
					this.orOn(function() {
						this.on('block.type', val(type));
						this.on(function() {
							list.forEach((desc) => {
								if (desc.array) {
									this.orOn(ref(`data:${desc.path}`).from('block'), '@>', ref('href.url').castJson());
								} else {
									this.orOn('href.url', ref(`data:${desc.path}`).from('block').castText());
								}
							});
						});
					});
				});
			});
		})
		.groupBy('block._id')
		.count({count: 'href.*'})
		.as('sub')
	).join('block', 'block._id', 'sub._id')
	.where('sub.count', 0)
	.then(function(rows) {
		const urls = [];
		rows.forEach((row) => {
			fhrefs[row.type].forEach((desc) => {
				const url = jsonPath.get(row.data, desc.path);
				if (url && !urls.includes(url) && !url.startsWith('/.well-known/')) urls.push(url);
			});
		});
		return Promise.all(urls.map((url) => {
			return All.run('href.add', {site, trx}, {url});
		})).then(function(list) {
			return {missings: rows.length, added: list.length};
		});
	});
};
exports.reinspect.schema = {
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

function callInspector(siteId, url, local) {
	let fileUrl = url;
	if (local === undefined) local = url.startsWith(`/.uploads/`);
	if (local) {
		fileUrl = url.replace(`/.uploads/`, `uploads/${siteId}/`);
		fileUrl = "file://" + Path.join(All.opt.dirs.data, fileUrl);
	}
	return All.inspector.get({
		url: fileUrl,
		local: local
	}).then(function(obj) {
		if (local) {
			obj.site = null;
			obj.url = url;
		}
		return obj;
	});
}
