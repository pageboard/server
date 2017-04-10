var Model = require('objection').Model;

function Block() {
	Model.apply(this, arguments);
}

Model.extend(Block);
module.exports = Block;

Block.tableName = 'block';

// prefer ajv validation over partial objection schema assumptions
// unfortunately, https://github.com/epoberezkin/ajv/issues/410
// so for now, errors will be reported by database and not by validation
// In objection 0.8, will be the default value
// https://github.com/Vincit/objection.js/issues/308
Block.pickJsonSchemaProperties = false;

Block.jsonSchema = {
	type: 'object',
	required: ['type'],
	id: '/api/blocks',
	properties: {
		id: {
			type: 'integer'
		},
		type: {
			type: 'string'
		},
		data: {
			type: 'object',
			default: {}
		},
		content: {
			type: 'object',
			default: {}
		},
		lang: {
			type: ['string', 'null']
		}
	},
	additionalProperties: false
};

Block.prototype.$beforeUpdate = function() {
	this.updated_at = new Date().toISOString();
};

Block.relationMappings = {
	children: {
		relation: Model.ManyToManyRelation,
		modelClass: Block,
		join: {
			from: 'block.id',
			through: {
				from: "relation.parent_id",
				to: "relation.child_id"
			},
			to: 'block.id'
		}
	},
	parents: {
		relation: Model.ManyToManyRelation,
		modelClass: Block,
		join: {
			from: 'block.id',
			through: {
				from: "relation.child_id",
				to: "relation.parent_id"
			},
			to: 'block.id'
		}
	}
};

Block.extendSchema = function extendSchema(schemas) {
	var types = Object.keys(schemas);
	if (types.length === 0) return;
	var schema = Block.jsonSchema;
	var blockProps = schema.properties;
	delete schema.properties;
	delete schema.additionalProperties;

	schema.switch = types.map(function(type) {
		var element = Object.assign({
			properties: {},
			specs: {}
		}, schemas[type]);
		return {
			if: {
				properties: {
					type: {
						constant: type
					}
				}
			},
			then: {
				properties: Object.assign({}, blockProps, {
					data: Object.assign({}, blockProps.data, {
						properties: element.properties,
						additionalProperties: false,
						required: element.required || []
					}),
					content: Object.assign({}, blockProps.content, {
						properties: stringProperties(element.specs || {}),
						additionalProperties: false
					})
				}),
				additionalProperties: false
			}
		};
	});
	Block.jsonSchema = schema;
}

function stringProperties(obj) {
	var props = {};
	for (var k in obj) {
		props[k] = {
			type: 'string'
		};
	}
	return props;
}
