var objection = require('objection');
var Model = objection.Model;
var QueryBuilder = objection.QueryBuilder;
var ref = objection.ref;

var crypto = require('crypto');

class Block extends Model {}

module.exports = Block;

Block.useLimitInFirst = true;

Block.tableName = 'block';

Block.idColumn = '_id';

Block.jsonSchema = {
	type: 'object',
	required: ['type'],
	id: '/api/blocks',
	properties: {
		id: {
			type: 'string'
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
		},
		standalone: { // a standalone block can have 0 or multiple parents
			type: 'boolean',
			default: false
		},
		updated_at: {
			format: 'date-time',
			type: 'string'
		}
	},
	additionalProperties: false
};

Block.jsonColumns = Object.keys(Block.jsonSchema.properties).map(col => `block.${col}`);

Block.prototype.$beforeInsert = function() {
	if (!this.id) return genId(this).then(function(id) {
		this.id = id;
	}.bind(this));
};

Block.prototype.$beforeUpdate = function() {
	this.updated_at = new Date().toISOString();
};

Block.relationMappings = {
	children: {
		relation: Model.ManyToManyRelation,
		modelClass: Block,
		join: {
			from: 'block._id',
			through: {
				from: "relation.parent_id",
				to: "relation.child_id"
			},
			to: 'block._id'
		}
	},
	parents: {
		relation: Model.ManyToManyRelation,
		modelClass: Block,
		join: {
			from: 'block._id',
			through: {
				from: "relation.child_id",
				to: "relation.parent_id"
			},
			to: 'block._id'
		}
	}
};

Block.extendSchema = function extendSchema(name, schemas) {
	var types = Object.keys(schemas);
	if (types.length === 0) return Block;
	var schema = Object.assign({}, Block.jsonSchema);
	schema.id += `/${name}`;
	var blockProps = schema.properties;
	delete schema.properties;
	delete schema.additionalProperties;

	schema.switch = types.map(function(type) {
		var element = Object.assign({
			properties: {},
			contents: {}
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
						properties: stringProperties(element.contents || {}),
						additionalProperties: false
					})
				}),
				additionalProperties: false
			}
		};
	});
	var DomainBlock = class extends Block {};
	Object.assign(DomainBlock, Block);
	DomainBlock.relationMappings.children.modelClass = DomainBlock;
	DomainBlock.relationMappings.parents.modelClass = DomainBlock;
	DomainBlock.jsonSchema = schema;
	return DomainBlock;
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

/**
 * this is the only function in pageboard that is defined both for client and for server !!!
 * similar function is defined in pageboard-write#store.js
*/
function genId() {
	return new Promise(function(resolve, reject) {
		crypto.randomBytes(8, function(err, buffer) {
			if (err) reject(err);
			else resolve(buffer.toString('hex'));
		});
	});
}

QueryBuilder.prototype.whereDomain = function(domain) {
	return this.joinRelation('parents')
		.where('parents.type', 'site')
		.whereJsonText('parents.data:domain', domain);
};

QueryBuilder.prototype.whereJsonText = function(a) {
	var args = Array.from(arguments).slice(1);
	args.unshift(ref(a).castText());
	return this.where.apply(this, args);
};

