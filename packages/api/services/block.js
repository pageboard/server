var ref = require('objection').ref;

exports = module.exports = function(opt) {
	return {
		name: 'block',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/block", All.auth.restrict('webmaster'), All.query, function(req, res, next) {
		exports.get(req.query).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.post("/.api/block", All.auth.restrict('webmaster'), All.body, function(req, res, next) {
		exports.add(req.body).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.put("/.api/block", All.auth.restrict('webmaster'), All.body, function(req, res, next) {
		exports.save(req.body).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.delete("/.api/block", All.auth.restrict('webmaster'), All.query, function(req, res, next) {
		exports.del(req.query).then(function(block) {
			res.send(block);
		}).catch(next);
	});
}

function QueryBlock(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	return All.api.DomainBlock(data.domain).then(function(Block) {
		if (data.type == "user" || data.type == "site") {
			// users and sites do not belong to sites. Only accept query by id.
			return Block.query().select(Block.tableColumns).where('block.id', data.id);
		}
		var q = Block.query().select(Block.tableColumns).whereDomain(Block.domain);
		if (data.id) {
			q.where('block.id', data.id).first().throwIfNotFound();
		} else if (data.text != null || data.data) {
			if (data.data) {
				var refs = {};
				asPaths(data.data, refs, 'block.data:');
				for (var k in refs) {
					q.where(ref(k).castText(), Array.isArray(refs[k]) ? 'IN' : '=', refs[k]);
				}
			}
			if (data.text != null) {
				var text = data.text.split(' ').filter(x => !!x).map(x => x + ':*').join(' <-> ');
				q.from(Block.raw([
					Block.raw("to_tsquery('unaccent', ?) AS query", [text]),
					'block'
				]));
				if (data.type) q.where('block.type', data.type);
				q.whereRaw('query @@ block.tsv');
				q.orderByRaw('ts_rank(block.tsv, query) DESC');
			}
			q.orderBy('updated_at', 'block.desc');
			if (data.paginate) q.offset(Math.max(parseInt(data.paginate) - 1 || 0, 0) * 10);
			q.limit(10);
		} else {
			throw new HttpError.BadRequest("Missing id, text, or data");
		}
		return q;
	});
}

exports.get = function(data) {
	return QueryBlock(data);
};

exports.add = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	return All.api.DomainBlock(data.domain).then(function(Block) {
		return Block.query().whereJsonText('block.data:domain', data.domain)
			.first().throwIfNotFound().then(function(site) {
				delete data.domain;
				return site.$relatedQuery('children').insert(data);
			});
	});
};

exports.save = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	if (!data.id) throw new HttpError.BadRequest("Missing id");
	return All.api.DomainBlock(data.domain).then(function(Block) {
		delete data.domain;
		return Block.query().where('block.id', data.id).patch(data);
	});
};

exports.del = function(data) {
	return QueryBlock(data).del();
};


function asPaths(obj, ret, pre) {
	if (!ret) ret = {};
	Object.keys(obj).forEach(function(key) {
		var val = obj[key];
		var cur = `${pre || ""}${key}`;
		if (Array.isArray(val) || typeof val != "object") {
			ret[cur] = val;
		} else if (typeof val == "object") {
			asPaths(val, ret, cur + '.');
		}
	});
	return ret;
}

