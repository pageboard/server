exports = module.exports = function(opt) {
	return {
		name: 'user'
	};
};


function QueryUser(data) {
	var ref = All.objection.ref;
	var q = All.Block.query().where('type', 'user');
	if (data.id) q.where('id', data.id);
	else if (data.email) q.where(ref('data:email').castText(), data.email);
	else throw new HttpError.BadRequest("Cannot query user", data);
	return q;
}

exports.get = function(data) {
	return QueryUser(data).first();
};

exports.add = function(data) {
	data = Object.assign({
		type: 'user'
	}, data);
	return All.Block.query().insert(data);
};

exports.save = function(data) {
	return QueryUser(data).patch(data);
};

exports.del = function(data) {
	return QueryUser(data).del();
};

