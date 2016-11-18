var Model = require('objection').Model;
var Path = require('path');

function Block() {
	Model.apply(this, arguments);
}

Model.extend(Block);
module.exports = Block;

Block.tableName = 'block';

Block.jsonSchema = {
	type: 'object',
	required: ['type', 'mime', 'site_id'],
	id: '/api/blocks',
	properties: {
		id: {
			type: 'integer'
		},
		type: {
			type: 'string'
		},
		mime: {
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
		},
		url: {
			type: ['string', 'null']
		},
		template: {
			type: ['string', 'null']
		},
		site_id: {
			type: 'integer'
		}
	}
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
	},
	site: {
		relation: Model.BelongsToOneRelation,
		modelClass: require('./site'),
		join: {
			from: 'block.site_id',
			to: 'site.id'
		}
	}
};

Block.initComponents = function defineComponents(components) {
	if (components.length === 0) return;
	var schema = Block.jsonSchema;
	var blockProps = schema.properties;

	schema.switch = components.map(function(path) {
		var component = require(path);
		if (component.prototype) component = component.prototype;
		var type = component.name || Path.basename(path);
		return {
			if: {
				properties: {
					type: {
						constant: type
					}
				}
			},
			then: {
				properties: {
					data: Object.assign({}, blockProps.data, {
						properties: component.properties,
						required: component.required || []
					}),
					content: Object.assign({}, blockProps.content, {
						properties: stringProperties(component.specs || {})
					})
				}
			}
		};
	});
	if (schema.switch.length) {
		delete blockProps.data;
		delete blockProps.content;
	}
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
