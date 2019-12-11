const common = require('./common');
const Model = common.Model;

const crypto = require('crypto');

class Block extends Model {
	$beforeInsert() {
		if (!this.id) return Block.genId().then(function(id) {
			this.id = id;
		}.bind(this));
	}

	$beforeUpdate() {
		this.updated_at = new Date().toISOString();
	}

	static schema(path) {
		var list = path.split('.');
		var type = list.shift();
		var sch = this.jsonSchema.selectCases[type];
		for (var i=0; i < list.length; i++) {
			sch = sch.properties && sch.properties[list[i]];
			if (!sch) throw new Error("Schema not found: " + path);
		}
		return sch;
	}

	$schema(type) {
		return this.constructor.schema(type || this.type);
	}

	get $source() {
		return this.$$source;
	}

	set $source(source) {
		this.$$source = source;
	}
}

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
			format: 'id'
		},
		type: {
			type: 'string',
			format: 'id'
		},
		data: {
			type: 'object'
		},
		expr: {
			type: 'object',
			nullable: true
		},
		content: {
			type: 'object'
		},
		standalone: { // a standalone block can have 0 or multiple parents
			type: 'boolean',
			default: false
		},
		updated_at: {
			format: 'date-time',
			type: 'string'
		},
		lock: {
			type: 'object',
			nullable: true,
			properties: {
				read: {
					type: 'array',
					nullable: true,
					items: {
						type: 'string',
						format: 'id'
					},
					uniqueItems: true
				},
				write: {
					type: 'array',
					nullable: true,
					items: {
						type: 'string',
						format: 'id'
					},
					uniqueItems: true
				}
			}
		}
	}
};

// _id is removed in $formatJson
Block.columns = Object.keys(Block.jsonSchema.properties).concat(['_id']);

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
	if (name != null) schema.$id += `/${name}`;
	var blockProps = schema.properties;
	delete schema.properties;

	schema.select = {
		"$data": '0/type'
	};
	schema.selectCases = {};

	var hrefs = {};

	types.forEach(function(type) {
		var element = Object.assign({
			properties: {},
			contents: {}
		}, schemas[type]);
		var hrefsList = [];
		findHrefs(element, hrefsList);
		if (hrefsList.length) hrefs[type] = hrefsList;
		var standProp = element.standalone ? {
			standalone: {
				const: true,
				default: true
			}
		} : {};
		schema.selectCases[type] = {
			$lock: element.$lock,
			parents: element.parents,
			upgrade: element.upgrade,
			properties: Object.assign({}, blockProps, standProp, {
				data: Object.assign({}, blockProps.data, {
					properties: element.properties,
					required: element.required || []
				}),
				content: Object.assign({}, blockProps.content, {
					properties: contentsNames(Block.normalizeContents(element.contents))
				})
			})
		};
	});
	var DomainBlock = class extends Block {};
	Object.assign(DomainBlock, Block);
	DomainBlock.relationMappings.children.modelClass = DomainBlock;
	DomainBlock.relationMappings.parents.modelClass = DomainBlock;
	DomainBlock.jsonSchema = schema;
	DomainBlock.hrefs = hrefs;

	delete DomainBlock.$$validator;
	DomainBlock.uniqueTag = function() {
		return schema.$id;
	};
	return DomainBlock;
};

Block.normalizeContents = function(contents) {
	if (!contents) return;
	if (typeof contents == "string") contents = {
		nodes: contents
	};
	if (!Array.isArray(contents)) {
		if (contents.spec) {
			contents = Object.assign({}, contents);
			contents.nodes = contents.spec;
			delete contents.spec;
		}
		if (!contents.nodes) {
			// support old version
			contents = Object.keys(contents).map(function(key) {
				var val = contents[key];
				if (typeof val == "string") {
					val = {nodes: val};
				} else {
					val = Object.assign({}, val);
					if (val.spec) {
						val.nodes = val.spec;
						delete val.spec;
					}
				}
				val.id = key;
				return val;
			});
		} else {
			contents = [contents];
		}
	}
	return contents;
};
function contentsNames(list) {
	var props = {};
	if (!list) return props;
	list.forEach(function(def) {
		props[def.id || ""] = {
			type: 'string'
		};
	});
	return props;
}

function findHrefs(schema, list, root) {
	if (!schema.properties) return;
	Object.keys(schema.properties).forEach(function(key) {
		var prop = schema.properties[key];
		if (root) key = `${root}.${key}`;
		if (prop.$helper && prop.$helper.name == "href") {
			list.push(key);
		} else {
			findHrefs(prop, list, key);
		}
	});
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

Block.genIdSync = function(length) {
	if (!length) length = 8;
	return crypto.randomBytes(length).toString('hex');
};

Block.QueryBuilder = class BlockQueryBuilder extends common.QueryBuilder {
	whereSite(siteId) {
		return this.joinRelated('parents')
		.where('parents.type', 'site')
		.where('parents.id', siteId);
	}
};

