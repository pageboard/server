exports = module.exports = function(opt) {
	return {
		name: 'user'
	};
};


function QueryUser(data) {
	var Block = All.api.Block;
	var q = Block.query().select(Block.tableColumns)
	.first().throwIfNotFound().where('type', 'user');
	if (data.id) {
		q.where('id', data.id);
		delete data.id;
	} else if (data.email) {
		q.whereJsonText('data:email', data.email);
		delete data.email;
	} else {
		throw new HttpError.BadRequest("Cannot query user", data);
	}
	return q;
}

exports.get = function(data) {
	return QueryUser(data);
};

exports.add = function(data) {
	data = Object.assign({
		type: 'user'
	}, data);
	return All.api.Block.query().insert(data);
};

exports.save = function(data) {
	return QueryUser(data).patch(data);
};

exports.del = function(data) {
	return QueryUser(data).del();
};

