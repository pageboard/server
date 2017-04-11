var URL = require('url');

exports = module.exports = function(opt) {
	this.opt = opt;
	return {
		name: 'href',
		service: init
	};
};

function init(All) {
	All.app.get(All.Href.jsonSchema.id, function(req, res, next) {
		exports.get(reqData(req)).then(function(href) {
			res.send(href);
		}).catch(next);
	});
	All.app.post(All.Href.jsonSchema.id, function(req, res, next) {
		exports.add(reqData(req)).then(function(href) {
			res.send(href);
		}).catch(next);
	});
}

function QueryHref(data) {
	if (!data.site) throw new HttpError.BadRequest("Missing site");
	var Href = All.Href;
	var q = joinSite(Href.query(), data.site);
	q.pick(Object.keys(Href.jsonSchema.properties));

	if (data.url) {
		q.where('url', data.url);
		q.orderBy('updated_at', 'desc');
	} else if (data.text) {
		q.from(Href.raw([
			'href',
			Href.raw("phraseto_tsquery('unaccent', ?) AS query", [data.text])
		]));
		if (data.type) q.where('type', data.type);
		q.whereRaw('query @@ tsv');
		q.orderByRaw('ts_rank(tsv, query) DESC');
	}
	q.limit(10);
	return q;
}

function joinSite(q, site) {
	return q.joinRelation('parent')
	.where('parent.type', 'site')
	.where(All.objection.ref('parent.data:url').castText(), site);
}

function reqData(req) {
	var obj = req.body || req.query;
	return obj;
}

function filterMeta(meta) {
	var obj = {};
	['mime', 'url', 'type', 'size', 'title', 'description', 'icon', 'thumbnail', 'site']
	.forEach(function(key) {
		if (meta[key] !== undefined) obj[key] = meta[key];
	});
	if (meta.url) obj.pathname = URL.parse(meta.url).pathname;
	return obj;
}

exports.get = function(data) {
	return QueryHref(data);
};

exports.add = function(data) {
	if (!data.url) throw new HttpError.BadRequest("Missing url");
	var ref = All.objection.ref;
	return All.inspector.get(data.url).then(function(meta) {
		meta = filterMeta(meta);
		return QueryHref(data).first().then(function(href) {
			if (!href) {
				return All.Href.query().insert(Object.assign({
					parent_id: All.Block.query().select('id')
						.where('type', 'site')
						.where(ref('data:url').castText(), data.site)
				}, meta)).returning('*');
			} else {
				return All.Href.query().patch(meta).where('id', href.id).first().returning('*');
			}
		});
	});
};

