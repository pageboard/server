var Model = require('objection').Model;

class Href extends Model {}

module.exports = Href;

Href.useLimitInFirst = true;

Href.tableName = 'href';

Href.idColumn = '_id';

Href.jsonSchema = {
	type: 'object',
	required: ['url', 'mime'],
	id: '/api/href',
	properties: {
		updated_at: {
			type: 'string',
			format: 'date-time'
		},
		mime: {
			type: 'string'
		},
		visible: {
			type: 'boolean',
			default: true
		},
		url: {
			type: 'string',
			format: 'uri'
		},
		type: {
			type: 'string'
		},
		title: {
			type: 'string'
		},
		icon: {
			type: ['string', 'null']
		},
		site: {
			type: 'string'
		},
		pathname: {
			type: 'string'
		},
		lang: {
			type: ['string', 'null']
		},
		meta: {
			type: 'object',
			default: {},
			properties: {
				description: {
					type: ['string', 'null']
				},
				thumbnail: {
					type: ['string', 'null'],
					format: 'uri'
				},
				size: {
					type: ['integer', 'null']
				},
				width: {
					type: ['integer', 'null']
				},
				height: {
					type: ['integer', 'null']
				},
				duration: {
					type: ['string', 'null']
				}
			}
		}
	},
	additionalProperties: false
};

Href.jsonColumns = Object.keys(Href.jsonSchema.properties).map(col => `href.${col}`);

/* not needed, default is set by db
Href.prototype.$beforeInsert = function() {
	this.created_at = new Date().toISOString();
};
*/

Href.prototype.$beforeUpdate = function() {
	this.updated_at = new Date().toISOString();
};

Href.relationMappings = {
	parent: {
		relation: Model.BelongsToOneRelation,
		modelClass: __dirname + '/block',
		join: {
			from: 'href._parent_id',
			to: 'block._id'
		}
	}
};

