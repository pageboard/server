

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
	var q = joinSite(All.Href.query(), data.site);

	if (data.url) {
		q.where('url', url);
	} else if (data.text) {
		// TODO full text search
		q.limit(10);
	}
	q.orderBy('updated_at', 'desc');
	return q;
}

function joinSite(q, site) {
	return q.joinRelation('site')
	.where('site.type', 'site')
	.where(ref('site.data:url').castText(), site);
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
				return joinSite(All.Href.query(), data.site).insert(Object.assign(meta, {
					site_id: ref('site.id')
				})).returning('*');
			} else {
				return All.Href.query().patch(meta).where('id', href.id).first().returning('*');
			}
		});
	});
};

