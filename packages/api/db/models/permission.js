var Model = require('objection').Model;

function Permission() {
	Model.apply(this, arguments);
}

Model.extend(Permission);
module.exports = Permission;

Permission.tableName = 'permission';

Permission.jsonSchema = {
	type: 'object',
	required: ['name'],
	id: '/api/permissions',
	properties: {
		id: {
			type: 'integer'
		},
		name: {
			type: 'string'
		}
	}
};
