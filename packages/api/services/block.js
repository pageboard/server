var ref = require('objection').ref;
var raw = require('objection').raw;

exports = module.exports = function(opt) {
	return {
		name: 'block',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/block", function(req, res, next) {
		var type = req.query.type;
		if (!type || ['user', 'site', 'page'].indexOf(type) >= 0) {
			return next(new HttpError.BadRequest("Cannot request that type"));
		}
		All.run('block.get', req.site, req.query).then(function(data) {
			res.json(data);
		}).catch(next);
	});
}

exports.get = function(site, data) {
	var q = site.$relatedQuery('children').select()
		.where('block.id', data.id);
	if (data.type) q.where('block.type', data.type);
	if (data.standalone) q.eager(`[children(childrenFilter)]`, {
		childrenFilter: function(query) {
			return query.select().where('block.standalone', false);
		}
	});
	return q.first().throwIfNotFound();
};
exports.get.schema = {
	required: ['id'],
	properties: {
		id: {
			type: 'string'
		},
		type: {
			type: 'string'
		},
		standalone: {
			type: 'boolean',
			default: false
		}
	},
	additionalProperties: false
};

exports.search = function(site, data) {
	var schemas = {};
	if (data.type) {
		schemas[data.type] = site.$schema(data.type);
	}
	if (data.parents && data.parents.type) {
		schemas[data.parents.type] = site.$schema(data.parents.type);
	}
	if (data.children && data.children.type) {
		schemas[data.children.type] = site.$schema(data.children.type);
	}
	var q = site.$relatedQuery('children');
	if (data.parent) {
		q.joinRelation('parents', {alias: 'parent'}).where('parent.id', data.parent);
	}
	if (data.child) {
		q.joinRelation('children', {alias: 'child'})
		.whereObject(data.child, schemas[data.children.type], 'child');
	}

	filterSub(q, data, schemas[data.type]);

	if (data.parents) q.eager('[parents(parentsFilter)]', {
		parentsFilter: function(query) {
			filterSub(query, data.parents, schemas[data.parents.type]);
		}
	});

	if (data.children) {
		if (data.children.count) {
			delete data.children.count;
			delete data.children.limit;
			delete data.children.offset;
			var qc = site.$relatedQuery('children').alias('children');
			whereSub(qc, data.children, schemas[data.children.type], 'children');
			qc.joinRelation('parents', {alias: 'parents'}).where('parents._id', ref('block._id'))
			q.select(All.api.Block.query().count().from(qc.as('sub')).as('childrenCount'));
		} else q.eager('[children(childrenFilter)]', {
			childrenFilter: function(query) {
				filterSub(query, data.children, schemas[data.children.type]);
			}
		});
	}

	return q.then(function(rows) {
		var obj = {
			data: rows,
			offset: data.offset,
			limit: data.limit,
			schemas: schemas
		};
		if (data.parents && data.parents.first) {
			rows.forEach(function(row) {
				row.parent = row.parents[0];
				delete row.parents;
			});
		}
		return obj;
	});
};
exports.search.schema = {
	required: ['type'],
	properties: {
		text: {
			type: ['null', 'string']
		},
		parent: {
			type: 'string'
		},
		child: {
			type: 'object',
		},
		parents: {
			type: 'object',
			required: ['type'],
			additionalProperties: false,
			properties: {
				first: {
					type: 'boolean',
					default: false
				},
				type: {
					type: 'string',
					not: { // TODO permissions should be managed dynamically
						oneOf: [{
							const: "user"
						}, {
							const: "site"
						}]
					}
				},
				text: {
					type: ['null', 'string']
				},
				data: {
					type: 'object'
				},
				order: {
					type: 'array',
					items: {
						type: 'string'
					}
				},
				limit: {
					type: 'integer',
					minimum: 0,
					maximum: 50,
					default: 10
				},
				offset: {
					type: 'integer',
					minimum: 0,
					default: 0
				}
			}
		},
		id: {
			type: 'string'
		},
		type: {
			type: 'string',
			not: { // TODO permissions should be managed dynamically
				oneOf: [{
					const: "user"
				}, {
					const: "site"
				}]
			}
		},
		data: {
			type: 'object'
		},
		order: {
			type: 'array',
			items: {
				type: 'string'
			}
		},
		limit: {
			type: 'integer',
			minimum: 0,
			maximum: 50,
			default: 10
		},
		offset: {
			type: 'integer',
			minimum: 0,
			default: 0
		},
		children: {
			type: 'object',
			required: ['type'],
			additionalProperties: false,
			properties: {
				type: {
					type: 'string',
					not: { // TODO permissions should be managed dynamically
						oneOf: [{
							const: "user"
						}, {
							const: "site"
						}]
					}
				},
				text: {
					type: ['null', 'string']
				},
				data: {
					type: 'object'
				},
				order: {
					type: 'array',
					items: {
						type: 'string'
					}
				},
				limit: {
					type: 'integer',
					minimum: 0,
					maximum: 50,
					default: 10
				},
				offset: {
					type: 'integer',
					minimum: 0,
					default: 0
				},
				count: {
					type: 'boolean',
					default: false
				}
			}
		}
	},
	additionalProperties: false
};
exports.search.external = true;

function whereSub(q, data, schema, alias = 'block') {
	if (data.type) {
		q.where(`${alias}.type`, data.type);
	}
	if (data.id) {
		q.where(`${alias}.id`, data.id);
	}
	if (data.data) {
		q.whereObject({data: data.data}, schema, alias);
	}
	if (data.text) {
		var text = data.text.split(/\W+/).filter(x => !!x).map(x => x + ':*').join(' <-> ');
		q.from(raw([
			raw("to_tsquery('unaccent', ?) AS query", [text]),
			alias
		]));
		q.whereRaw(`query @@ ${alias}.tsv`);
		q.orderByRaw(`ts_rank(${alias}.tsv, query) DESC`);
	}
}

function filterSub(q, data, schema) {
	q.select();
	whereSub(q, data, schema);
	if (data.order) data.order.forEach(function(order) {
		var {col, dir} = parseOrder('block', order);
		q.orderBy(col, dir);
	});
	q.orderBy('block.updated_at', 'asc');
	q.offset(data.offset).limit(data.limit);
}

exports.find = function(site, data) {
	data.limit = 1;
	data.offset = 0;
	return exports.search(site, data).then(function(obj) {
		return {
			data: obj.data.length == 1 ? obj.data[0] : null,
			schemas: obj.schemas
		};
	});
};
exports.find.schema = {
	required: ['id', 'type'],
	properties: {
		id: {
			type: 'string'
		},
		type: {
			type: 'string',
			not: { // TODO permissions should be managed dynamically
				oneOf: [{
					const: "user"
				}, {
					const: "site"
				}]
			}
		},
		children: exports.search.schema.properties.children,
		parent: exports.search.schema.properties.parent,
		parents: exports.search.schema.properties.parents
	},
	additionalProperties: false
};
exports.find.external = true;

exports.add = function(site, data) {
	var id = data.parent;
	delete data.parent;
	return site.$relatedQuery('children').insert(data).then(function(child) {
		if (!id) return child;
		return site.$relatedQuery('children').where('block.id', id)
		.first().throwIfNotFound().then(function(parent) {
			return parent.$relatedQuery('children', site.trx).relate(child).then(function() {
				return child;
			});
		});
	});
};
exports.add.schema = {
	properties: {
		parent: {
			type: 'string'
		}
	},
	additionalProperties: true
};
exports.add.external = true;

exports.save = function(site, data) {
	return exports.get(site, data).forUpdate().then(function(block) {
		return site.$relatedQuery('children').patchObject(data)
		.where('block.id', block.id).then(function(count) {
			if (count == 0) throw new Error(`Block not found for update ${data.id}`);
		});
	});
};
exports.save.schema = {
	required: ['id', 'type'],
	properties: {
		id: {
			type: 'string'
		},
		type: {
			type: 'string'
		}
	},
	additionalProperties: true
};
exports.save.external = true;

exports.del = function(site, data) {
	return site.$relatedQuery('children')
		.where('block.id', data.id)
		.whereIn('block.type', data.type)
		.delete();
};
exports.del.schema = {
	required: ['id', 'type'],
	properties: {
		id: {
			type: 'string'
		},
		type: {
			type: 'array',
			items: {
				type: 'string',
				not: { // TODO permissions should be managed dynamically
					oneOf: [{
						const: "user"
					}, {
						const: "site"
					}]
				}
			}
		}
	},
	additionalProperties: false
};
exports.del.external = true;

exports.gc = function(days) {
	return raw(`DELETE FROM block USING (
		SELECT count(relation.child_id), b._id FROM block AS b
			LEFT OUTER JOIN relation ON (relation.child_id = b._id)
			LEFT JOIN block AS p ON (p._id = relation.parent_id AND p.type='site')
		WHERE b.type NOT IN ('user', 'site') AND extract('day' from now() - b.updated_at) >= ?
		GROUP BY b._id
	) AS usage WHERE usage.count = 0 AND block._id = usage._id`, [
		days
	]).then(function(result) {
		return {
			length: result.rowCount
		};
	});
};

function parseOrder(table, str) {
	var col = str;
	var dir = 'asc';
	if (col.startsWith('-')) {
		dir = 'desc';
		col = col.substring(1);
	}
	var list = col.split('.');
	var first = list.shift();
	col = `${table}.${first}`;
	if (list.length > 0) col += `:${list.join('.')}`;
	return {col: ref(col), dir};
}

