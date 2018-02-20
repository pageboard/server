var objection = require('objection');
var Model = objection.Model;
var QueryBuilder = objection.QueryBuilder;

class Href extends Model {}

module.exports = Href;

Href.useLimitInFirst = true;

Href.tableName = 'href';

Href.idColumn = '_id';

Href.jsonSchema = {
	type: 'object',
	required: ['url', 'mime'],
	$id: '/api/href',
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
			oneOf: [{
				type: 'string',
				format: 'uri'
			}, {
				type: "string",
				pattern: "^(\/[a-zA-Z0-9-._]*)+$"
			}]
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
					// local images are stored as data-uri, no need to path pattern
					oneOf: [{
						type: "null"
					}, {
						type: "string",
						format: "uri"
					}]
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

Href.columns = Object.keys(Href.jsonSchema.properties);
Href.tableColumns = Href.columns.map(col => `href.${col}`);

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

QueryBuilder.prototype.whereParentDomain = function(domain) {
	return this.joinRelation('parent')
		.where('parent.type', 'site')
		.whereJsonText('parent.data:domain', domain);
};

