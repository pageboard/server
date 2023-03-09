const { Model } = require('objection');
const common = require('./common');

class Href extends common.Model {
	static useLimitInFirst = true;

	static tableName = 'href';

	static idColumn = '_id';

	static jsonSchema = {
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
				type: 'string',
				format: 'uri-reference',
				nullable: true
			},
			canonical: {
				type: 'string',
				format: 'uri-reference',
				nullable: true
			},
			type: {
				type: 'string'
			},
			title: {
				type: 'string'
			},
			icon: {
				type: 'string',
				format: 'uri-reference',
				nullable: true
			},
			site: {
				type: 'string'
			},
			pathname: {
				type: 'string'
			},
			lang: {
				nullable: true,
				type: "string"
			},
			preview: {
				nullable: true,
				type: "string"
			},
			meta: {
				type: 'object',
				default: {},
				properties: {
					size: {
						nullable: true,
						type: "integer"
					},
					width: {
						nullable: true,
						type: "integer"
					},
					height: {
						nullable: true,
						type: "integer"
					},
					duration: {
						nullable: true,
						type: "string",
						pattern: /^\d+:\d{2}:\d{2}$/.source
					}
				}
			}
		}
	};

	static columns = Object.keys(Href.jsonSchema.properties);

	static relationMappings = {
		parent: {
			relation: Model.BelongsToOneRelation,
			modelClass: __dirname + '/block',
			join: {
				from: 'href._parent_id',
				to: 'block._id'
			}
		}
	};

	static QueryBuilder = class HrefQueryBuilder extends common.QueryBuilder {
		whereSite(id) {
			return this.joinRelated('parent')
				.where('parent.type', 'site')
				.where('parent.id', id);
		}
	};
}

module.exports = Href;
