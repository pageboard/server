var Model = require('@kapouer/objection').Model;
var Path = require('path');

function Block() {
	Model.apply(this, arguments);
}

Model.extend(Block);
module.exports = Block;

Block.tableName = 'block';

Block.jsonSchema = {
	type: 'object',
	required: ['type', 'mime'],
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
		permissions: {
			type: 'object',
			properties: {
				read: {
					type: 'array',
					items: {
						type: 'string'
					},
					uniqueItems: true
				},
				add: {
					type: 'array',
					items: {
						type: 'string'
					},
					uniqueItems: true
				},
				save: {
					type: 'array',
					items: {
						type: 'string'
					},
					uniqueItems: true
				},
				del: {
					type: 'array',
					items: {
						type: 'string'
					},
					uniqueItems: true
				}
			}
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
	}
};

Block.initElements = function initElements(elements) {
	if (elements.length === 0) return;
	var schema = Block.jsonSchema;
	var blockProps = schema.properties;

	schema.switch = elements.map(function(path) {
		var element = require(path);
		if (element.prototype) element = element.prototype;
		var type = element.name || Path.basename(path);
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
						properties: element.properties,
						required: element.required || []
					}),
					content: Object.assign({}, blockProps.content, {
						properties: stringProperties(element.specs || {})
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
