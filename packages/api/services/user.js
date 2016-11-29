exports = module.exports = function(opt) {
	return {
		name: 'user'
	};
};

function QueryUser(data) {
	var obj = { type: 'user' };
	if (data.id) obj.id = data.id;
	else if (data.url) obj.url = data.url;
	else if (data.email) obj['data.email'] = data.email;
	else throw new HttpError.BadRequest("Cannot query user", data);
	return All.Block.query().where(obj);
}

exports.get = function(data) {
	return QueryUser(data).first();
};

exports.add = function(data) {
	data = Object.assign({
		type: 'user',
		mime: 'application/json'
	}, data);
	return All.Block.query().insert(data);
};

exports.save = function(data) {
	return QueryUser(data).patch(data);
};

exports.del = function(data) {
	return QueryUser(data).del();
};

