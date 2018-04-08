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
			anyOf: [{
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
			anyOf: [{type: "null"}, {type: "string"}]
		},
		site: {
			type: 'string'
		},
		pathname: {
			type: 'string'
		},
		lang: {
			anyOf: [{type: "null"}, {type: "string"}]
		},
		meta: {
			type: 'object',
			default: {},
			properties: {
				description: {
					anyOf: [{type: "null"}, {type: "string"}]
				},
				thumbnail: {
					// local images are stored as data-uri, no need to path pattern
					anyOf: [{
						type: "null"
					}, {
						type: "string",
						format: "uri"
					}]
				},
				size: {
					anyOf: [{type: "null"}, {type: "integer"}]
				},
				width: {
					anyOf: [{type: "null"}, {type: "integer"}]
				},
				height: {
					anyOf: [{type: "null"}, {type: "integer"}]
				},
				duration: {
					anyOf: [{type: "null"}, {type: "integer"}]
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

class HrefQueryBuilder extends QueryBuilder {}

HrefQueryBuilder.prototype.whereSite = function(id) {
	return this.joinRelation('parent')
		.where('parent.type', 'site')
		.where('parent.id', id);
};

Href.QueryBuilder = HrefQueryBuilder;

