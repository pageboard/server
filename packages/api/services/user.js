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
		q.whereJsonText('user.data:email', 'in', data.email);
		delete data.email;
	}
	return q;
}

exports.get = function(data) {
	return QueryUser(data);
};
exports.get.schema = {
	$action: 'read',
	anyOf: [{
		required: ['email']
	}, {
		required: ['id']
	}],
	properties: {
		id: {
			type: 'string',
			minLength: 1,
			format: 'id'
		},
		email: {
			title: 'User email',
			type: 'array',
			items: {
				type: 'string',
				format: 'email',
				transform: ['trim', 'toLowerCase']
			}
		}
	},
	additionalProperties: false
};

exports.add = function(data) {
	return QueryUser({
		email: [data.email]
	}).then(function(user) {
		throw new HttpError.Conflict();
	}).catch(function(err) {
		if (err.status == 404) {
			return All.api.Block.query().insert({
				data: { email: data.email },
				type: 'user'
			});
		} else {
			throw err;
		}
	});
};
exports.add.schema = {
	$action: 'add',
	required: ['email'],
	properties: {
		email: {
			type: 'string',
			format: 'email',
			transform: ['trim', 'toLowerCase']
		}
	},
	additionalProperties: false
};

exports.save = function(data) {
	return QueryUser(data).patchObject(data);
};

exports.del = function(data) {
	return QueryUser(data).del();
};
Object.defineProperty(exports.del, 'schema', {
	get: function() {
		var schema = Object.assign({}, exports.get.schema);
		schema.$action = 'del';
		return schema;
	}
});
