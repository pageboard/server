var ref = require('objection').ref;
var Path = require('path');
var URL = require('url');

exports = module.exports = function(opt) {
	this.opt = opt;
	return {
		name: 'href',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/hrefs", All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('href.search', req, req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.post("/.api/href", All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('href.add', req, req.body).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.delete("/.api/href", All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('href.del', req, req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
}

exports.get = function(site, user, data) {
	return All.api.Href.query(site.trx).select('href._id')
	.whereSite(site.id)
	.where('href.url', data.url).first();
};

exports.get.schema = {
	$action: 'read',
	required: ['url'],
	properties: {
		url: {
			type: 'string',
			format: 'uri'
		}
	}
};

exports.search = function(req, data) {
	var Href = All.api.Href;
	var q = Href.query().select().whereSite(req.site.id);

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

	if (data.url) {
		q.where('url', data.url);
	} else if (data.text) {
		q.from(Href.raw([
			Href.raw("websearch_to_tsquery('unaccent', ?) AS query", [data.text]),
			'href'
		]));
		q.where('href.visible', true);
		q.whereRaw('query @@ href.tsv');
		q.orderByRaw('ts_rank(href.tsv, query) DESC');
		q.orderBy('updated_at', 'desc');
	} else {
		q.where('href.visible', true);
		q.orderBy('updated_at', 'desc');
	}
	q.offset(data.offset).limit(data.limit);
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
			anyOf: [{
				type: 'string',
				format: 'uri'
			}, {
				type: "string",
				format: 'pathname'
			}]
		},
		text: {
			type: 'string',
			format: 'singleline'
		},
		limit: {
			type: 'integer',
			minimum: 0,
			maximum: 50,
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
	var site = req.site;
	var Href = All.api.Href;

	var url = data.url;
	var objUrl = URL.parse(url);
	var isLocal = false;
	if (site.hostname == objUrl.hostname) {
		url = data.url;
		data.url = objUrl.pathname;
		isLocal = true;
	} else if (!objUrl.hostname) {
		url = site.href + url;
		isLocal = true;
	}

	var p;

	if (isLocal && !data.url.startsWith('/.')) {
		// consider it's a page
		p = All.page.get(req, {
			url: data.url
		}).then(function(pageBlock) {
			return {
				mime: 'text/html; charset=utf-8',
				type: 'link',
				title: pageBlock.data && pageBlock.data.title || "",
				site: null,
				pathname: objUrl.pathname,
				url: objUrl.path
			};
		});
	} else {
		p = callInspector(site.id, data.url, isLocal);
	}
	return p.then(function(result) {
		return exports.get(req, data).forUpdate().then(function(href) {
			if (!href) {
				return site.$relatedQuery('hrefs').insert(result).returning(Href.columns);
			} else {
				return site.$relatedQuery('hrefs').patchObject(result).where('_id', href._id)
				.first().returning(Href.columns);
			}
		});
	});
};

exports.add.schema = {
	$action: 'add',
	required: ['url'],
	properties: {
		url: {
			anyOf: [{
				type: 'string',
				format: 'uri'
			}, {
				type: "string",
				format: 'pathname'
			}]
		}
	}
};

exports.save = function(req, data) {
	var Href = All.api.Href;
	return exports.get(req, data)
	.throwIfNotFound()
	.forUpdate()
	.then(function(href) {
		return req.site.$relatedQuery('hrefs').patchObject({
			title: data.title
		}).where('_id', href._id).first().returning(Href.columns);
	});
};

exports.save.schema = {
	$action: 'save',
	required: ['url', 'title'],
	properties: {
		url: {
			anyOf: [{
				type: 'string',
				format: 'uri'
			}, {
				type: "string",
				format: 'pathname'
			}]
		},
		title: {
			type: 'string',
			format: 'singleline'
		}
	}
};

exports.del = function(req, data) {
	return exports.get(req, data).throwIfNotFound().then(function(href) {
		return req.site.$relatedQuery('hrefs').patchObject({
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
			anyOf: [{
				type: 'string',
				format: 'uri'
			}, {
				type: "string",
				format: 'pathname'
			}]
		}
	}
};

exports.gc = function(days) {
	return Promise.resolve([]);
	// TODO use sites schemas to known which paths to check:
	// for example, data.url comes from elements.image.properties.url.input.name == "href"

	// TODO href.site IS NULL used to be p.data->>'domain' = href.site
	// BOTH are wrong since they won't touch external links...
	// TODO the outer join on url is also a bit wrong since it does not use href._parent !!!
	return All.api.Href.raw(`DELETE FROM href USING (
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
};

exports.reinspect = function(data) {
	// usage
	// to force reinspect
	// UPDATE block SET data = jsonb_set(data, '{meta}', '{}'::jsonb) WHERE type='image';
	// UPDATE href SET meta = '{}'::jsonb WHERE type='image';
	// pageboard href.reinspect site=idsite type=image meta.width=
	// (site is optional)
	var site = {
		id: data.site
	};
	delete data.site;
	var q = All.api.Href.query().joinRelation('parent')
	.select('href.url', 'href._id', 'parent.id AS site')
	.whereObject(data);
	if (site.id) q.where('parent.id', site.id);
	return q.then(function(rows) {
		return Promise.all(rows.map(function(href) {
			return callInspector(href.site, href.url)
			.then(function(obj) {
				return All.api.Href.query().patchObject(obj).where('_id', href._id);
			}).catch(function(err) {
				console.error("Error inspecting", href, err);
			});
		}));
	}).then(function(arr) {
		console.info("Inspected", arr.length, "hrefs");
		return Promise.all([
			All.api.Block.raw(`UPDATE block
				SET data = jsonb_set(block.data, '{meta,width}', href.meta->'width')
				FROM href, block AS site, relation AS r WHERE block.type = 'image'
				AND block.data->'meta'->'width' IS NULL
				AND href.url = block.data->>'url'
				AND href.meta->'width' IS NOT NULL
				AND r.child_id = block._id AND site._id = r.parent_id AND site.type = 'site'
				${site.id ? ' AND site.id = ?' : ''}
				AND href._parent_id = site._id`, site.id),
			All.api.Block.raw(`UPDATE block
				SET data = jsonb_set(block.data, '{meta,height}', href.meta->'height')
				FROM href, block AS site, relation AS r WHERE block.type = 'image'
				AND block.data->'meta'->'height' IS NULL
				AND href.url = block.data->>'url'
				AND href.meta->'height' IS NOT NULL
				AND r.child_id = block._id AND site._id = r.parent_id AND site.type = 'site'
				${site.id ? ' AND site.id = ?' : ''}
				AND href._parent_id = site._id`, site.id),
			All.api.Block.raw(`UPDATE block
				SET data = jsonb_set(block.data, '{meta,size}', href.meta->'size')
				FROM href, block AS site, relation AS r WHERE block.type = 'image'
				AND block.data->'meta'->'size' IS NULL
				AND href.url = block.data->>'url'
				AND href.meta->'size' IS NOT NULL
				AND r.child_id = block._id AND site._id = r.parent_id AND site.type = 'site'
				${site.id ? ' AND site.id = ?' : ''}
				AND href._parent_id = site._id`, site.id),
			All.api.Block.raw(`UPDATE block
				SET data = jsonb_set(block.data, '{meta,mime}', to_jsonb(href.mime))
				FROM href, block AS site, relation AS r WHERE block.type = 'image'
				AND block.data->'meta'->'mime' IS NULL
				AND href.url = block.data->>'url'
				AND r.child_id = block._id AND site._id = r.parent_id AND site.type = 'site'
				${site.id ? ' AND site.id = ?' : ''}
				AND href._parent_id = site._id`, site.id)
		]).then(function(counts) {
			require('assert').equal(counts[0].rowCount, counts[1].rowCount, "not updated same number of meta.width and meta.height");
			console.info("Updated", counts[0].rowCount, "image blocks meta dimensions");
		});
	});
};
exports.reinspect.schema = {
	$action: 'write',
	required: ['type'],
	get properties() {
		return Object.assign({}, All.api.Href.jsonSchema.properties, {
			site: {
				type: 'string',
				format: 'id'
			}
		});
	},
	additionalProperties: false,
	defaults: false
};

function callInspector(siteId, url, local) {
	var fileUrl = url;
	var dir = All.opt.upload.dir;
	if (local === undefined) local = url.startsWith(`/.${dir}/`);
	if (local) {
		fileUrl = url.replace(`/.${dir}/`, `${dir}/${siteId}/`);
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
