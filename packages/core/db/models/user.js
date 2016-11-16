var Model = require('objection').Model;

function User() {
	Model.apply(this, arguments);
}

Model.extend(User);
module.exports = User;

User.tableName = 'user';

User.jsonSchema = {
	type: 'object',
	required: ['email', 'password'],
	id: '/api/users',
	properties: {
		id: {
			type: 'integer'
		},
		email: {
			type: 'string',
			format: 'email'
		},
		password: {
			type: 'string',
			minLength: 6
		},
		name: {
			type: 'string'
		},
		firstname: {
			type: 'string'
		}
	}
};

User.relationMappings = {
	permissions: {
		relation: Model.ManyToManyRelation,
		modelClass: __dirname + '/permission',
		join: {
			from: 'user.id',
			through: {
				from: 'user_permission.user_id',
				to: 'user_permission.permission_id',
				extra: ["read", "add", "save", "del"]
			},
			to: 'permission.id'
		}
	}
};
