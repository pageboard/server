var objection = require('objection');
var Model = objection.Model;
var common = require('./common');

class Href extends common.Model {}

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
		preview: {
			anyOf: [{type: "null"}, {type: "string"}]
		},
		meta: {
			type: 'object',
			default: {},
			properties: {
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

Href.QueryBuilder = class HrefQueryBuilder extends common.QueryBuilder {
	whereSite(id) {
		return this.joinRelation('parent')
		.where('parent.type', 'site')
		.where('parent.id', id);
	}
};

