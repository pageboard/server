exports = module.exports = function(opt) {
	return {
		name: 'user',
		service: init
	};
};

function init() {

}

function QueryUser({trx}, data) {
	var Block = All.api.Block;
	var q = Block.query(trx).alias('user').select()
	.first().throwIfNotFound().where('user.type', 'user');
	if (!data.id && !data.email) throw new HttpError.BadRequest("Missing id or email");
	if (data.id) {
		q.where('user.id', data.id);
	} else if (data.email) {
		q.whereJsonText('user.data:email', data.email);
	}
	return q;
}

exports.get = function(req, data) {
	return QueryUser(req, data);
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
			type: 'string',
			format: 'email',
			transform: ['trim', 'toLowerCase']
		}
	}
};

exports.add = function(req, data) {
	return QueryUser(req, {
		email: data.email
	}).catch(function(err) {
		if (err.status != 404) throw err;
		return All.api.Block.query(req.trx).insert({
			data: { email: data.email },
			type: 'user'
		}).returning('id');
	});
};
exports.add.schema = {
	$action: 'add',
	required: ['email'],
	properties: {
		email: {
			title: 'User email',
			type: 'string',
			format: 'email',
			transform: ['trim', 'toLowerCase']
		}
	}
};

exports.del = function(req, data) {
	return QueryUser(req, data).del();
};
exports.del.schema = Object.assign({}, exports.get.schema, {
	$action: 'del'
});

