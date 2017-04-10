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
	var q = All.Block.query();
	if (!data.id) throw new HttpError.BadRequest("Missing id");
	q.where('id', data.id);
	return q;
}

function reqData(req) {
	var obj = req.body || req.query;
	return obj;
}

exports.get = function(data) {
	return QueryBlock(data).select('block.*')
	.eager('children.^').first().then(function(block) {
		if (!block) throw new HttpError.NotFound("No block found");
		return block;
	});
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

