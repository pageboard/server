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
	$id: '/api/blocks',
	properties: {
		id: {
			type: 'string',
			pattern: '^[\\w-]+$'
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
		},
		locks: {
			oneOf: [{
				type: 'array',
				items: {
					type: 'string',
					pattern: '^\\w+$'
				},
				uniqueItems: true
			}, {
				type: 'null'
			}]
		},
		keys: {
			oneOf: [{
				type: 'array',
				items: {
					type: 'string',
					pattern: '^\\w+$'
				},
				uniqueItems: true
			}, {
				type: 'null'
			}]
		}
	},
	additionalProperties: false
};

Block.columns = Object.keys(Block.jsonSchema.properties);
Block.tableColumns = Block.columns.map(col => `block.${col}`);

Block.prototype.$beforeInsert = function() {
	if (!this.id) return Block.genId().then(function(id) {
		this.id = id;
	}.bind(this));
};

Block.prototype.$beforeUpdate = function() {
	this.updated_at = new Date().toISOString();
};

Block.createNotFoundError = function(data) {
	return new HttpError.NotFound("Block not found");
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
	},
	hrefs: {
		relation: Model.HasManyRelation,
		modelClass: __dirname + '/href',
		join: {
			from: 'block._id',
			to: 'href._parent_id'
		}
	}
};

Block.extendSchema = function extendSchema(name, schemas) {
	var types = Object.keys(schemas);
	if (types.length === 0) return Block;
	var schema = Object.assign({}, Block.jsonSchema);
	schema.$id += `/${name}`;
	var blockProps = schema.properties;
	delete schema.properties;
	delete schema.additionalProperties;

	schema.select = {
		"$data": '0/type'
	};
	schema.selectCases = {};

	types.forEach(function(type) {
		var element = Object.assign({
			properties: {},
			contents: {}
		}, schemas[type]);
		var standProp = element.standalone ? {
			standalone: {
				type: {
					constant: true
				},
				default: true
			}
		} : {};
		schema.selectCases[type] = {
			properties: Object.assign({}, blockProps, standProp, {
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
		};
	});
	var DomainBlock = class extends Block {};
	Object.assign(DomainBlock, Block);
	DomainBlock.relationMappings.children.modelClass = DomainBlock;
	DomainBlock.relationMappings.parents.modelClass = DomainBlock;
	DomainBlock.jsonSchema = schema;
	return DomainBlock;
}

Block.schemaByType = function(type) {
	return this.jsonSchema.selectCases[type];
};

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
Block.genId = function(length) {
	if (!length) length = 8;
	return new Promise(function(resolve, reject) {
		crypto.randomBytes(length, function(err, buffer) {
			if (err) reject(err);
			else resolve(buffer.toString('hex'));
		});
	});
};

class BlockQueryBuilder extends QueryBuilder {}

BlockQueryBuilder.prototype.whereSite = function(siteId) {
	return this.joinRelation('parents')
		.where('parents.type', 'site')
		.where('parents.id', siteId);
};

BlockQueryBuilder.prototype.whereJsonText = function(a) {
	var args = Array.from(arguments).slice(1);
	args.unshift(ref(a).castText());
	return this.where.apply(this, args);
};

Block.QueryBuilder = BlockQueryBuilder;

