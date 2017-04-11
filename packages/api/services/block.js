exports = module.exports = function(opt) {
	return {
		name: 'block',
		service: init
	};
};

function init(All) {
	All.app.get(All.Block.jsonSchema.id, function(req, res, next) {
		exports.get(reqData(req)).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.post(All.Block.jsonSchema.id, function(req, res, next) {
		exports.add(reqData(req)).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.put(All.Block.jsonSchema.id, function(req, res, next) {
		exports.save(reqData(req)).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.delete(All.Block.jsonSchema.id, function(req, res, next) {
		exports.del(reqData(req)).then(function(block) {
			res.send(block);
		}).catch(next);
	});
}

function QueryBlock(data) {
	var Block = All.Block;
	var q = Block.query().pick(Object.keys(Block.jsonSchema.properties));
	if (data.text) {
		q.from(Block.raw([
			'block',
			Block.raw("phraseto_tsquery('unaccent', ?) AS query", [data.text])
		]));
		if (data.type) q.where('type', data.type);
		q.whereRaw('query @@ tsv');
		q.orderByRaw('ts_rank(tsv, query) DESC');
		q.limit(10);
	} else if (!data.id) {
		throw new HttpError.BadRequest("Missing id");
	} else {
		q.where('id', data.id);
	}
	return q;
}

function reqData(req) {
	var obj = req.body || req.query;
	return obj;
}

exports.get = function(data) {
	return QueryBlock(data);
};

exports.add = function(data) {
	var parent = data.parent;
	delete data.parent;
	return QueryBlock({id: parent}).first().then(function(parent) {
		data.parents = [{
			'#dbRef': parent.id
		}];
		return All.Block.query().insertGraph(data);
	});
};

exports.save = function(data) {
	return QueryBlock(data).patch(data);
};

exports.del = function(data) {
	return QueryBlock(data).del();
};

