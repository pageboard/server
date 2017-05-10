var objection = require('objection');
var Model = objection.Model;
var QueryBuilder = objection.QueryBuilder;
var ref = objection.ref;

var crypto = require('crypto');

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
		}
	},
	additionalProperties: false
};

Block.jsonColumns = Object.keys(Block.jsonSchema.properties);

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

QueryBuilder.prototype.whereSite = function(site) {
	return this.joinRelation('parents')
		.where('parents.type', 'site')
		.where(ref('parents.data:url').castText(), site);
};

QueryBuilder.prototype.whereUrl = function(url) {
	return this.where(ref("block.data:url").castText(), url);
};

