exports = module.exports = function(opt) {
	return {
		name: 'block',
		service: init
	};
};

function init(All) {
	All.app.get(All.Block.jsonSchema.id, All.query, function(req, res, next) {
		exports.get(req.query).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.post(All.Block.jsonSchema.id, All.body, function(req, res, next) {
		exports.add(req.body).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.put(All.Block.jsonSchema.id, All.body, function(req, res, next) {
		exports.save(req.body).then(function(block) {
			res.send(block);
		}).catch(next);
	});
	All.app.delete(All.Block.jsonSchema.id, All.query, function(req, res, next) {
		exports.del(req.query).then(function(block) {
			res.send(block);
		}).catch(next);
	});
}

function QueryBlock(data) {
	var Block = All.Block;
	var q = Block.query().select(Block.jsonColumns);
	if (data.text) {
		var text = data.text;
		var variant = 'phrase';
		if (text.indexOf(' ') < 0) {
			// prefix matching when only one word is being typed
			text += ':*';
			variant = '';
		}
		q.from(Block.raw([
			Block.raw(variant + "to_tsquery('unaccent', ?) AS query", [text]),
			'block'
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
		return All.Block.query().insertGraph(data).returning(All.Block.jsonColumns)
	});
};

exports.save = function(data) {
	return QueryBlock(data).patch(data);
};

exports.del = function(data) {
	return QueryBlock(data).del();
};

