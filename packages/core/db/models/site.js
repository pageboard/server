var Model = require('objection').Model;

function Site() {
	Model.apply(this, arguments);
}

Model.extend(Site);
module.exports = Site;

Site.tableName = 'site';

Site.jsonSchema = {
	type: 'object',
	required: ['domain', 'name'],
	id: '/api/sites',
	properties: {
		id: {
			type: 'integer'
		},
		domain: {
			type: 'string'
		},
		name: {
			type: 'string'
		}
	}
};

Site.relationMappings = {
	blocks: {
		relation: Model.HasManyRelation,
		modelClass: __dirname + '/block',
		join: {
			from: 'site.id',
			to: 'block.site_id'
		}
	}
};
