const common = require('./common');
const Model = common.Model;
const Traverse = require('json-schema-traverse');

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
		const list = path.split('.');
		const type = list.shift();
		let sch = this.jsonSchema.selectCases[type];
		for (let i = 0; i < list.length; i++) {
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
	const types = Object.keys(schemas);
	if (types.length === 0) return Block;
	const schema = Object.assign({}, Block.jsonSchema);
	if (name != null) schema.$id += `/${name}`;
	const blockProps = schema.properties;
	delete schema.properties;

	schema.select = {
		"$data": '0/type'
	};
	schema.selectCases = {};

	const hrefs = {};

	types.forEach(function(type) {
		const element = Object.assign({
			properties: {},
			contents: {}
		}, schemas[type]);
		const hrefsList = [];
		findHrefs(element, hrefsList);
		if (hrefsList.length) hrefs[type] = hrefsList;
		const standProp = element.standalone ? {
			standalone: {
				const: true,
				default: true
			}
		} : {};
		Traverse(element, {
			cb: (schema, pointer, root, parentPointer, keyword, parent, name) => {
				if (schema.type == "string" && schema.format) schema.coerce = true;
			}
		});
		schema.selectCases[type] = {
			$lock: element.$lock,
			parents: element.parents,
			upgrade: element.upgrade,
			output: element.output,
			standalone: element.standalone,
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
	const DomainBlock = class extends Block {};
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
				let val = contents[key];
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
	const props = {};
	if (!list) return props;
	list.forEach(function(def) {
		props[def.id || ""] = {
			type: 'string'
		};
	});
	return props;
}

function findHrefs(schema, list, root, isArray) {
	if (!schema.properties) return;
	Object.keys(schema.properties).forEach(function(key) {
		const prop = schema.properties[key];
		if (isArray) key = root;
		else if (root) key = `${root}.${key}`;
		const helper = prop.$helper;
		if (helper && helper.name == "href") {
			let ftype = helper.filter && helper.filter.type || [];
			if (!Array.isArray(ftype)) ftype = [ftype];
			list.push({
				path: key,
				types: ftype,
				array: isArray
			});
		} else if (prop.type == "array") {
			findHrefs({properties: {items: prop.items}}, list, key, true);
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

