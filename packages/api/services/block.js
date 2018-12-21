var ref = require('objection').ref;
var raw = require('objection').raw;

exports = module.exports = function() {
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
			All.send(res, data);
		}).catch(next);
	});
}

exports.get = function(site, data) {
	var q = site.$relatedQuery('children').select()
	.where('block.id', data.id);
	if (data.type) q.where('block.type', data.type);
	if (data.standalone) q.eager('[children(childrenFilter)]', {
		childrenFilter: function(query) {
			return query.select().where('block.standalone', false);
		}
	});
	return q.first().throwIfNotFound();
};
exports.get.schema = {
	$action: 'read',
	required: ['id'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		type: {
			type: 'string',
			format: 'id'
		},
		standalone: {
			type: 'boolean',
			default: false
		}
	}
};

exports.search = function(site, data) {
	var schemas = {};
	if (data.type) {
		schemas[data.type] = site.$schema(data.type);
	}
	var parents = data.parents && data.parents.type ? data.parents : null;
	if (parents) {
		schemas[parents.type] = site.$schema(parents.type);
	}
	var children = data.children && data.children.type ? data.children : null;
	if (children) {
		schemas[children.type] = site.$schema(children.type);
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
	if (parents) q.eager('[parents(parentsFilter)]', {
		parentsFilter: function(query) {
			filterSub(query, parents, schemas[parents.type]);
		}
	});

	if (children) {
		if (children.count) {
			delete children.count;
			delete children.limit;
			delete children.offset;
			var qc = site.$relatedQuery('children').alias('children');
			whereSub(qc, children, schemas[children.type], 'children');
			qc.joinRelation('parents', {alias: 'parents'})
			.where('parents._id', ref('block._id'));
			q.select(All.api.Block.query().count().from(qc.as('sub')).as('childrenCount'));
		} else q.eager('[children(childrenFilter)]', {
			childrenFilter: function(query) {
				filterSub(query, children, schemas[children.type]);
			}
		});
	}

	return q.then(function(rows) {
		var obj = {
			items: rows,
			offset: data.offset,
			limit: data.limit
		};
		if (parents && parents.first) {
			rows.forEach(function(row) {
				row.parent = row.parents[0];
				delete row.parents;
			});
		}
		return obj;
	});
};
exports.search.schema = {
	title: 'Search blocks',
	$action: 'read',
	required: ['type'],
	properties: {
		parent: {
			title: 'Parent id',
			nullable: true,
			type: "string",
			format: 'id'
		},
		child: {
			title: 'Filter using child values ? No this object holds filter for a child that is INNER JOINED: TODO: replace this field by a boolean "inner join" on children field',
			type: 'object',
		},
		id: {
			title: 'Block id',
			nullable: true,
			type: "string",
			format: 'id'
		},
		type: {
			title: 'Type',
			type: 'string',
			format: 'id',
			not: { // TODO permissions should be managed dynamically
				oneOf: [{
					const: "user"
				}, {
					const: "site"
				}]
			},
			$filter: {
				name: 'element',
				standalone: true
			}
		},
		text: {
			title: 'Search text',
			nullable: true,
			type: "string",
			format: "singleline"
		},
		data: {
			title: 'Filters',
			type: 'object'
		},
		order: {
			title: 'Sort by',
			type: 'array',
			items: {
				type: 'string',
				format: 'singleline'
			}
		},
		limit: {
			title: 'Limit',
			type: 'integer',
			minimum: 0,
			maximum: 1000,
			default: 10
		},
		offset: {
			title: 'Offset',
			type: 'integer',
			minimum: 0,
			default: 0
		},
		parents: {
			title: 'Parents',
			type: 'object',
			required: ['type'],
			properties: {
				first: {
					title: 'Single',
					type: 'boolean',
					default: false
				},
				type: {
					title: 'Type',
					type: 'string',
					format: 'id',
					not: { // TODO permissions should be managed dynamically
						oneOf: [{
							const: "user"
						}, {
							const: "site"
						}]
					},
					$filter: {
						name: 'element',
						standalone: true
					}
				},
				text: {
					title: 'Search text',
					nullable: true,
					type: "string",
					format: "singleline"
				},
				data: {
					title: 'Filters',
					type: 'object'
				},
				order: {
					title: 'Sort by',
					type: 'array',
					items: {
						type: 'string',
						format: 'singleline'
					}
				},
				limit: {
					title: 'Limit',
					type: 'integer',
					minimum: 0,
					maximum: 1000,
					default: 10
				},
				offset: {
					title: 'Offset',
					type: 'integer',
					minimum: 0,
					default: 0
				}
			}
		},
		children: {
			title: 'Children',
			type: 'object',
			required: ['type'],
			properties: {
				type: {
					title: 'Element',
					type: 'string',
					format: 'id',
					not: { // TODO permissions should be managed dynamically
						oneOf: [{
							const: "user"
						}, {
							const: "site"
						}]
					},
					$filter: {
						name: 'element',
						standalone: true
					}
				},
				text: {
					title: 'Search text',
					nullable: true,
					type: "string",
					format: "singleline"
				},
				data: {
					title: 'Filters',
					type: 'object'
				},
				order: {
					title: 'Sort by',
					type: 'array',
					items: {
						type: 'string',
						format: "singleline"
					}
				},
				limit: {
					title: 'Limit',
					type: 'integer',
					minimum: 0,
					maximum: 1000,
					default: 10
				},
				offset: {
					title: 'Offset',
					type: 'integer',
					minimum: 0,
					default: 0
				},
				count: {
					title: 'Get count',
					type: 'boolean',
					default: false
				}
			}
		}
	}
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
		q.from(raw([
			raw("websearch_to_tsquery('unaccent', ?) AS query", [data.text]),
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
	var meta = site.$standalones[data.type];
	return exports.search(site, data).then(function(obj) {
		return {
			item: obj.items.length == 1 ? obj.items[0] : null,
			meta: meta
		};
	});
};
exports.find.schema = {
	title: 'Find one block',
	$action: 'read',
	required: ['id', 'type'], // TODO allow find with same filters as search
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		type: {
			type: 'string',
			format: 'id',
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
	}
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
	title: 'Add a block',
	properties: {
		parent: {
			type: 'string',
			format: 'id'
		}
	},
	additionalProperties: true // WARNING disables api validation
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
	title: 'Modify a block',
	$action: 'save',
	required: ['id', 'type'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		type: {
			type: 'string',
			format: 'id'
		}
	},
	additionalProperties: true // WARNING disables api validation
};
exports.save.external = true;

exports.del = function(site, data) {
	return site.$relatedQuery('children')
	.where('block.id', data.id)
	.whereIn('block.type', data.type)
	.delete();
};
exports.del.schema = {
	title: 'Delete a block',
	$action: 'del',
	required: ['id', 'type'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		type: {
			type: 'array',
			items: {
				type: 'string',
				format: 'id',
				not: { // TODO permissions should be managed dynamically
					oneOf: [{
						const: "user"
					}, {
						const: "site"
					}]
				}
			}
		}
	}
};
exports.del.external = true;

exports.gc = function(days) {
	// this might prove useless
	return All.api.Block.raw(`DELETE FROM block USING (
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

