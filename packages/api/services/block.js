var ref = require('objection').ref;

exports = module.exports = function(opt) {
	return {
		name: 'block',
		service: init
	};
};

function init(All) {
}

function QueryBlock(Block, data) {
	if (data.type == "user" || data.type == "site") {
		// users and sites do not belong to sites. Only accept query by id.
		if (!data.id) throw new HttpError.BadRequest("Missing id");
		return Block.query().select(Block.tableColumns).where('block.id', data.id);
	}
	var q = Block.query().select(Block.tableColumns).whereDomain(Block.domain);
	if (data.type) q.where('block.type', data.type);
	if (data.id) {
		q.where('block.id', data.id);
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
}

exports.get = function(data) {
	return All.api.DomainBlock(data.domain).then(function(Block) {
		return QueryBlock(Block, data).first().throwIfNotFound();
	});
};

exports.search = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	return All.api.DomainBlock(data.domain).then(function(Block) {
		return QueryBlock(Block, data).then(function(rows) {
			var obj = {
				data: rows
			};
			if (data.type && Block.jsonSchema.selectCases[data.type]) {
				obj.schema = Block.jsonSchema.selectCases[data.type];
			}
			return obj;
		});
	});
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
		return All.site.get({domain: data.domain}).clearSelect().select('site._id')
		.then(function(site) {
			delete data.domain;
			return site.$relatedQuery('children')
			.where('block.id', data.id).patch(data).skipUndefined().then(function(count) {
				if (count == 0) throw new Error(`Block not found for update ${data.id}`);
			});
		});
	});
};

exports.del = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	if (!data.id) throw new HttpError.BadRequest("Missing id");
	return All.api.DomainBlock(data.domain).then(function(Block) {
		return Block.query().where('id',
			Block.query().select('block.id').where('block.id', data.id).whereDomain(Block.domain)
		).delete();
	});
};

exports.gc = function(days) {
	return All.api.Block.raw(`DELETE FROM block USING (
		SELECT count(relation.child_id), b._id FROM block AS b
			LEFT OUTER JOIN relation ON (relation.child_id = b._id)
			LEFT JOIN block AS p ON (p._id = relation.parent_id AND p.type='site')
		WHERE b.type NOT IN ('user', 'site') AND extract('day' from now() - b.updated_at) >= ?
		GROUP BY b._id
	) AS usage WHERE usage.count = 0 AND block._id = usage._id`, [
		days
	]).then(function(result) {
		return {
			length: result.rowCount
		};
	});
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

