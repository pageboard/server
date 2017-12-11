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
		if (data.text) {
			var text = data.text.split(' ').filter(x => !!x).map(x => x + ':*').join(' <-> ');
			q.from(Block.raw([
				Block.raw("to_tsquery('unaccent', ?) AS query", [text]),
				'block'
			]));
			if (data.type) q.where('block.type', data.type);
			q.whereRaw('query @@ block.tsv');
			q.orderByRaw('ts_rank(block.tsv, query) DESC');
			q.orderBy('updated_at', 'block.desc');
			if (data.paginate) q.offset(Math.max(parseInt(data.paginate) - 1 || 0, 0) * 10);
			q.limit(10);
		} else if (!data.id) {
			throw new HttpError.BadRequest("Missing id");
		} else {
			q.where('block.id', data.id).first().throwIfNotFound();
		}
		return q;
	});
}

exports.get = function(data) {
	return QueryBlock(data);
};

exports.add = function(data) {
	var parent = data.parent;
	delete data.parent;
	return All.Block.query().select('_id').where('_id', parent).first().then(function(parent) {
		data.parents = [{
			'#dbRef': parent._id
		}];
		return All.Block.query().insertGraph(data).returning(All.Block.tableColumns)
	});
};

exports.save = function(data) {
	return QueryBlock(data).patch(data);
};

exports.del = function(data) {
	return QueryBlock(data).del();
};

