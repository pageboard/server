var ref = require('objection').ref;
var URL = require('url');
var Path = require('path');

exports = module.exports = function(opt) {
	this.opt = opt;
	return {
		name: 'href',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/hrefs", All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('href.search', req.site, req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.post("/.api/href", All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('href.add', req.site, req.body).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.delete("/.api/href", All.auth.restrict('webmaster'), function(req, res, next) {
		All.run('href.del', req.site, req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
}

function filterResult(result) {
	var obj = {meta:{}};
	['mime', 'url', 'type', 'title', 'icon', 'site']
	.forEach(function(key) {
		if (result[key] !== undefined) obj[key] = result[key];
	});
	if (result.url) obj.pathname = URL.parse(result.url).pathname;
	var meta = {};
	['width', 'height', 'duration', 'size', 'thumbnail', 'description']
	.forEach(function(key) {
		if (result[key] !== undefined) obj.meta[key] = result[key];
	});
	if (obj.type == "image" && obj.mime != "text/html" && !obj.meta.thumbnail) {
		obj.meta.thumbnail = obj.url;
	}
	return obj;
}

function embedThumbnail(obj) {
	var thumb = obj.meta.thumbnail;
	if (!thumb) return obj;
	return All.image.thumbnail(thumb).then(function(datauri) {
		obj.meta.thumbnail = datauri;
		return obj;
	});
}

exports.get = function(site, data) {
	return All.api.Href.query().select('href._id')
		.whereSite(site.id)
		.where('href.url', data.url).first();
};

exports.get.schema = {
	required: ['url'],
	properties: {
		url: {
			type: 'string'
		}
	},
	additionalProperties: false
};

exports.search = function(site, data) {
	var Href = All.api.Href;
	var q = Href.query().select(Href.tableColumns).whereSite(site.id);

	if (data.type && data.type.length > 1) {
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
		var text = data.text.split(' ').filter(x => !!x).map(x => x + ':*').join(' <-> ');
		q.from(Href.raw([
			Href.raw("to_tsquery('unaccent', ?) AS query", [text]),
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
	properties: {
		type: {
			type: 'array',
			items: {
				type: 'string'
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
			type: 'string'
		},
		text: {
			type: 'string'
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
	},
	additionalProperties: false
};

exports.add = function(site, data) {
	var Href = All.api.Href;
	var Block = All.api.Block;

	var url = data.url;
	var objUrl = URL.parse(url);
	var isLocal = false;
	if (site.hostname == objUrl.hostname) {
		url = data.url;
		data.url = objUrl.path;
		isLocal = true;
	} else if (!objUrl.hostname) {
		url = site.href + url;
		isLocal = true;
	}

	var p;

	if (isLocal && !data.url.startsWith('/.')) {
		// consider it's a page
		p = All.page.get(site, {
			url: data.url
		}).then(function(pageBlock) {
			return {
				mime: 'text/html; charset=utf-8',
				type: 'link',
				title: pageBlock.data.title,
				site: null,
				ext: 'html',
				pathname: objUrl.pathname
			};
		});
	} else {
		p = All.inspector.get({url: url, nofavicon: isLocal}).catch(function(err) {
			// inspector failure
			if (typeof err == 'number') err = new HttpError[err]("Inspector failure");
			throw err;
		}).then(filterResult).then(embedThumbnail);
	}
	return p.then(function(result) {
		if (isLocal) result.url = data.url;
		return exports.get(site, data).then(function(href) {
			if (!href) {
				return site.$relatedQuery('hrefs').insert(result).returning(Href.tableColumns);
			} else {
				return site.$relatedQuery('hrefs').patchObject(result).where('_id', href._id)
					.first().returning(Href.tableColumns);
			}
		});
	});
};

exports.add.schema = {
	required: ['url'],
	properties: {
		url: {
			type: 'string'
		}
	},
	additionalProperties: false
};

exports.save = function(site, data) {
	var Href = All.api.Href;
	return exports.get(site, data).then(function(href) {
		if (!href) {
			return exports.add(site, data);
		} else {
			return Href.query().patchObject({title: data.title}).where('_id', href._id);
		}
	});
};

exports.save.schema = {
	required: ['url', 'title'],
	properties: {
		url: {
			type: 'string'
		},
		title: {
			type: 'string'
		}
	},
	additionalProperties: false
};

exports.del = function(site, data) {
	return exports.get(site, data).throwIfNotFound().then(function(href) {
		return site.$relatedQuery('hrefs').patchObject({
			visible: false
		}).where('_id', href._id).then(function() {
			href.visible = false;
			return href;
		});
	});
};

exports.del.schema = {
	required: ['url'],
	properties: {
		url: {
			type: 'string'
		}
	},
	additionalProperties: false
};

exports.gc = function(days) {
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

