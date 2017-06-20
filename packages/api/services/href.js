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
	All.app.get("/.api/href", All.query, function(req, res, next) {
		exports.get(req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.post("/.api/href", All.body, function(req, res, next) {
		exports.add(req.body).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.delete("/.api/href", All.query, function(req, res, next) {
		exports.del(req.query).then(function(href) {
			res.send(href);
		}).catch(next);
	});
}

function QueryHref(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	var Href = All.api.Href;
	var q = Href.query().select(Href.jsonColumns);
	joinSite(q, data);

	if (data.url) {
		q.where('url', data.url);
	} else if (data.text) {
		var text = data.text;
		var variant = 'phrase';
		if (text.indexOf(' ') < 0) {
			// prefix matching when only one word is being typed
			text += ':*';
			variant = '';
		}
		q.from(Href.raw([
			Href.raw(variant + "to_tsquery('unaccent', ?) AS query", [text]),
			'href'
		]));
		if (data.type) q.where('href.type', data.type);
		q.where('href.visible', true);
		q.whereRaw('query @@ href.tsv');
		q.orderByRaw('ts_rank(href.tsv, query) DESC');
	} else {
		q.where('href.visible', true);
		q.orderBy('updated_at', 'desc');
	}
	q.limit(10);
	return q;
}

function joinSite(q, data) {
	return q.joinRelation('parent')
		.where('parent.type', 'site')
		.where(All.api.ref('parent.data:url').castText(), data.domain);
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
	var url = data.url;
	var Href = All.api.Href;
	var Block = All.api.Block;

	return All.inspector.get(url).catch(function(err) {
		// inspector failure
		if (typeof err == 'number') err = new HttpError[err]("Inspector failure");
		throw err;
	}).then(filterResult).then(embedThumbnail)
	.then(function(result) {
		return QueryHref(data).first().select('href._id').then(function(href) {
			if (!href) {
				return Href.query().insert(Object.assign({
					_parent_id: Block.query().select('_id')
						.where('type', 'site')
						.where(ref('data:domain').castText(), data.domain)
				}, result)).returning(Href.jsonColumns);
			} else {
				return Href.query().patch(result).where('_id', href._id)
					.first().returning(Href.jsonColumns);
			}
		});
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

