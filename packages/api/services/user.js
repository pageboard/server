exports = module.exports = function(opt) {
	return {
		name: 'user'
	};
};


function QueryUser(data) {
	var Block = All.api.Block;
	var q = Block.query().alias('user').select()
	.first().throwIfNotFound().where('user.type', 'user');
	if (!data.id && !data.email) throw new HttpError.BadRequest("Missing id or email");
	if (data.id) {
		q.where('user.id', data.id);
		delete data.id;
	} else if (data.email) {
		q.whereJsonText('user.data:email', data.email);
		delete data.email;
	}
	return q;
}

exports.get = function(data) {
	return QueryUser(data);
};
exports.get.schema = {
	anyOf: [{
		required: ['email']
	}, {
		required: ['id']
	}],
	properties: {
		id: {
			type: 'string',
			minLength: 1
		},
		get email() {
			return All.api.Block.schema('user.data.email');
		}
	},
	additionalProperties: false
};

exports.add = function(data) {
	data = Object.assign({
		type: 'user'
	}, data);
	return All.api.Block.query().insert(data);
};

exports.save = function(data) {
	return QueryUser(data).patchObject(data);
};

exports.del = function(data) {
	return QueryUser(data).del();
};

