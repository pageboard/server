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
	All.app.get("/.api/href", All.auth.restrict('webmaster'), All.query, function(req, res, next) {
		exports.get(req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.post("/.api/href", All.auth.restrict('webmaster'), All.body, function(req, res, next) {
		exports.add(req.body).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.delete("/.api/href", All.auth.restrict('webmaster'), All.query, function(req, res, next) {
		exports.del(req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
}

function QueryHref(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	var Href = All.api.Href;
	var q = Href.query().select(Href.tableColumns).whereParentDomain(data.domain);

	var types = Array.isArray(data.type) ? data.type : (data.type && [data.type] || []);

	if (types.length) {
		q.whereIn('href.type', types);
	}
	if (data.maxSize) {
		q.where(All.api.ref('href.meta:size'), '<=', data.maxSize);
	}
	if (data.maxWidth) {
		q.where(All.api.ref('href.meta:width'), '<=', data.maxWidth);
	}
	if (data.maxHeight) {
		q.where(All.api.ref('href.meta:height'), '<=', data.maxHeight);
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
	// TODO use objection pagination
	if (data.paginate) q.offset(Math.max(parseInt(data.paginate) - 1 || 0, 0) * 10);
	q.limit(10);
	return q;
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

exports.get = function(data) {
	return QueryHref(data);
};

exports.add = function(data) {
	if (!data.url) throw new HttpError.BadRequest("Missing url");
	var ref = All.api.ref;
	var Href = All.api.Href;
	var Block = All.api.Block;

	var url = data.url;
	var objUrl = URL.parse(url);
	var isLocal = false;
	if (objUrl.hostname == data.domain) {
		url = data.url;
		data.url = objUrl.path;
		isLocal = true;
	} else if (!objUrl.hostname) {
		url = All.domains.host(data.domain) + url;
		isLocal = true;
	}

	var p;

	if (isLocal && !data.url.startsWith('/.')) {
		// consider it's a page
		p = All.block.get({
			data: {url: data.url},
			domain: data.domain
		}).then(function(pageBlock) {
			return {
				mime: 'text/html; charset=utf-8',
				type: 'link',
				title: pageBlock.data.title,
				site: data.domain,
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
		return QueryHref(data).first().select('href._id').then(function(href) {
			if (!href) {
				return Href.query().insert(Object.assign({
					_parent_id: All.site.get({domain: data.domain}).clearSelect().select('_id')
				}, result)).returning(Href.tableColumns);
			} else {
				return Href.query().patch(result).where('_id', href._id)
					.first().returning(Href.tableColumns);
			}
		});
	});
};

exports.save = function(data) {
	var Href = All.api.Href;
	return QueryHref(data).first().select('href._id').then(function(href) {
		if (!href) {
			return exports.add(data);
		} else {
			return Href.query().patch({title: data.title}).where('_id', href._id);
		}
	});
};

exports.del = function(data) {
	if (!data.url) throw new HttpError.BadRequest("Missing url");
	return QueryHref(data).select('href._id').first().then(function(href) {
		if (!href) throw new HttpError.NotFound("No href found for this url");
		return All.api.Href.query().patch({
			visible: false
		}).where('_id', href._id).then(function() {
			href.visible = false;
			return href;
		});
	});
};

exports.migrate = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	if (!data.data || !data.data.domain) throw new HttpError.BadRequest("Missing data.domain");
	return All.api.Href.query().where('site', data.domain).patch({
		site: data.data.domain
	}).skipUndefined();
};

exports.gc = function(days) {
	return All.api.Href.raw(`DELETE FROM href USING (
		SELECT count(block.*) AS count, href._id FROM href
		LEFT OUTER JOIN block ON (block.data->>'url' = href.url)
		LEFT JOIN relation AS r ON (r.child_id = block._id)
		LEFT JOIN block AS p ON (p._id = r.parent_id AND p.type='site' AND p.data->>'domain' = href.site)
		WHERE extract('day' from now() - href.updated_at) >= ?
		GROUP BY href._id
	) AS usage WHERE usage.count = 0 AND href._id = usage._id
	RETURNING href.type, href.pathname, href.site AS hostname`, [
		days
	]).then(function(result) {
		return result.rows;
	});
};

