var Model = require('objection').Model;

function UserPermission() {
	Model.apply(this, arguments);
}

Model.extend(UserPermission);
module.exports = UserPermission;

UserPermission.tableName = 'user_permission';

UserPermission.jsonSchema = {
	type: 'object',
	id: '/api/userPermissions',
	properties: {
		id: {
			type: 'integer'
		},
		user_id: {
			type: 'integer'
		},
		permission_id: {
			type: 'integer'
		},
		read: {
			type: 'boolean'
		},
		add: {
			type: 'boolean'
		},
		save: {
			type: 'boolean'
		},
		del: {
			type: 'boolean'
		}
	}
};

UserPermission.relationMappings = {
	user: {
		relation: Model.BelongsToOneRelation,
		modelClass: __dirname + '/user',
		join: {
			from: 'user_permission.user_id',
			to: 'user.id'
		}
	},
	permission: {
		relation: Model.BelongsToOneRelation,
		modelClass: __dirname + '/permission',
		join: {
			from: 'user_permission.permission_id',
			to: 'permission.id'
		}
	}
};
