var Model = require('objection').Model;

function Href() {
	Model.apply(this, arguments);
}

Model.extend(Href);
module.exports = Href;

Href.tableName = 'href';

// prefer ajv validation over partial objection schema assumptions
// unfortunately, https://github.com/epoberezkin/ajv/issues/410
// so for now, errors will be reported by database and not by validation
// In objection 0.8, will be the default value
// https://github.com/Vincit/objection.js/issues/308
Href.pickJsonSchemaProperties = false;

Href.jsonSchema = {
	type: 'object',
	required: ['url', 'mime'],
	id: '/api/href',
	properties: {
		id: {
			type: 'integer'
		},
		site_id: {
			type: 'integer'
		},
		mime: {
			type: 'string'
		},
		url: {
			type: 'string',
			format: 'uri'
		},
		type: {
			type: 'string'
		},
		size: {
			type: 'integer',
			default: 0
		},
		title: {
			type: 'string'
		},
		description: {
			type: ['string', 'null']
		},
		icon: {
			type: ['string', 'null']
		},
		thumbnail: {
			type: ['string', 'null'],
			format: 'uri'
		},
		site: {
			type: 'string'
		},
		pathname: {
			type: 'string'
		},
		lang: {
			type: ['string', 'null']
		}
	},
	additionalProperties: false
};

/* not needed, default is set by db
Href.prototype.$beforeInsert = function() {
	this.created_at = new Date().toISOString();
};
*/

Href.prototype.$beforeUpdate = function() {
	this.updated_at = new Date().toISOString();
};

Href.relationMappings = {
	site: {
		relation: Model.BelongsToOneRelation,
		modelClass: __dirname + '/Block',
		join: {
			from: 'Href.site_id',
			to: 'Block.id'
		}
	}
};

