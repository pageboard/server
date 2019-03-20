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
		All.run('block.find', req, req.query).then(function(data) {
			All.send(res, data);
		}).catch(next);
	});

	All.app.get("/.api/blocks", function(req, res, next) {
		All.run('block.search', req, req.query).then(function(data) {
			All.send(res, data);
		}).catch(next);
	});

	All.app.post('/.api/blocks', function(req, res, next) {
		All.run('block.write', req, req.body).then(function(data) {
			All.send(res, data);
		}).catch(next);
	});
}

exports.get = function(req, data) {
	var q = req.site.$relatedQuery('children').select()
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

exports.search = function(req, data) {
	var site = req.site;
	var schemas = {};
	if (data.type) {
		schemas[data.type] = site.$schema(data.type);
	}

	var parents = data.parents || {};
	if (parents.type) {
		schemas[parents.type] = site.$schema(parents.type);
	} else if (parents.id) {
		// ok
	} else {
		parents = null;
	}
	var children = data.children || {};
	if (children.type) {
		schemas[children.type] = site.$schema(children.type);
	} else if (children.id) {
		// ok
	} else {
		children = null;
	}
	var valid = false;
	var q = site.$relatedQuery('children');
	if (data.parent) {
		var parentList = data.parent.parents;
		if (parentList && Array.isArray(parentList)) {
			if (parentList.length) {
				valid = true;
				parentList.forEach(function(item, i) {
					var alias = 'parent_' + i;
					q.joinRelation('parents', {alias: alias});
					if (!item.type) throw new HttpError.BadRequest("Missing parents.item.type");
					schemas[item.type] = site.$schema(item.type);
					q.whereObject(item, schemas[item.type], alias);
				});
			}
			delete data.parent.parents;
		}
		if (Object.keys(data.parent).length) {
			if (!data.parent.type) throw new HttpError.BadRequest("Missing parent.type");
			valid = true;
			q.joinRelation('parents', {alias: 'parent'});
			schemas[data.parent.type] = site.$schema(data.parent.type);
			q.whereObject(data.parent, schemas[data.parent.type], 'parent');
		}
	}
	if (data.child && Object.keys(data.child).length) {
		if (!data.child.type) throw new HttpError.BadRequest("Missing child.type");
		q.joinRelation('children', {alias: 'child'});
		schemas[data.child.type] = site.$schema(data.child.type);
		q.whereObject(data.child, schemas[data.child.type], 'child');
	}
	var eagers = [];

	valid = filterSub(q, data, schemas[data.type]) || valid;
	if (!valid) throw new HttpError.BadRequest("Insufficient search parameters");
	if (parents) eagers.push('parents(parentsFilter) as parents');

	if (children) {
		if (children.count) {
			var qchildren = Object.assign({}, children);
			delete qchildren.count;
			delete qchildren.limit;
			delete qchildren.offset;
			var qc = site.$relatedQuery('children').alias('children');
			whereSub(qc, qchildren, schemas[children.type], 'children');
			qc.joinRelation('parents', {alias: 'parents'})
			.where('parents._id', ref('block._id'));
			q.select(All.api.Block.query().count().from(qc.as('sub')).as('childrenCount'));
		} else {
			eagers.push('children(childrenFilter) as children');
		}
	}
	if (eagers.length) q.eager(`[${eagers.join(',')}]`, {
		parentsFilter: function(query) {
			filterSub(query, parents, schemas[parents.type]);
		},
		childrenFilter: function(query) {
			filterSub(query, children, schemas[children.type]);
		}
	});

	return q.then(function(rows) {
		var metas = [];
		Object.keys(schemas).forEach(function(type) {
			var meta = site.$standalones[type];
			if (meta && !site.$pagetypes[type]) metas.push(meta);
		});
		var obj = {
			items: rows,
			offset: data.offset,
			limit: data.limit,
			metas: metas
		};
		if (parents && parents.first || children && children.first) {
			rows.forEach(function(row) {
				if (parents && parents.first) {
					if (row.parents && row.parents.length) row.parent = row.parents[0];
					delete row.parents;
				}
				if (children && children.first) {
					if (row.children && row.children.length) row.child = row.children[0];
					delete row.children;
				}
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
			title: 'Select by parent',
			description: 'search blocks only having these parents',
			type: "object"
		},
		child: {
			title: 'Select by child',
			description: 'search blocks only having these children',
			type: 'object',
		},
		id: {
			title: 'Select by id',
			anyOf: [{ /* because nullable does not have priority */
				type: 'null'
			}, {
				type: "string",
				format: 'id'
			}]
		},
		type: {
			title: 'Select by type',
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
				standalone: true,
				contentless: true
			}
		},
		text: {
			title: 'Search text',
			nullable: true,
			type: "string",
			format: "singleline"
		},
		data: {
			title: 'Filter by data',
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
			properties: {
				first: {
					title: 'Single',
					type: 'boolean',
					default: false
				},
				id: {
					title: 'Select by id',
					anyOf: [{ /* because nullable does not have priority */
						type: 'null'
					}, {
						type: "string",
						format: 'id'
					}]
				},
				type: {
					title: 'Select by type',
					type: 'string',
					format: 'id',
					not: { // TODO permissions should be managed dynamically
						oneOf: [{
							const: "user"
						}, {
							const: "site"
						}]
					},
					nullable: true,
					$filter: {
						name: 'element',
						standalone: true,
						contentless: true
					}
				},
				text: {
					title: 'Search text',
					nullable: true,
					type: "string",
					format: "singleline"
				},
				data: {
					title: 'Filter by data',
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
			properties: {
				first: {
					title: 'Single',
					type: 'boolean',
					default: false
				},
				id: {
					title: 'Select by id',
					anyOf: [{ /* because nullable does not have priority */
						type: 'null'
					}, {
						type: "string",
						format: 'id'
					}]
				},
				type: {
					title: 'Select by type',
					type: 'string',
					format: 'id',
					not: { // TODO permissions should be managed dynamically
						oneOf: [{
							const: "user"
						}, {
							const: "site"
						}]
					},
					nullable: true,
					$filter: {
						name: 'element',
						standalone: true,
						contentless: true
					}
				},
				text: {
					title: 'Search text',
					nullable: true,
					type: "string",
					format: "singleline"
				},
				data: {
					title: 'Filter by data',
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
	var valid = false;
	if (data.type) {
		var stand = schema && schema.properties.standalone;
		valid = stand && stand.const === true || valid;
		q.where(`${alias}.type`, data.type);
	} else {
		if (!data.type) throw new HttpError.BadRequest("Missing type");
	}
	if (data.id) {
		valid = true;
		q.where(`${alias}.id`, data.id);
	}
	if (data.data && Object.keys(data.data).length > 0) {
		valid = true;
		q.whereObject({data: data.data}, schema, alias);
	}
	if (data.text) {
		valid = true;
		q.from(raw("websearch_to_tsquery('unaccent', ?) AS query, ??", [data.text, alias]));
		q.whereRaw(`query @@ ${alias}.tsv`);
		q.orderByRaw(`ts_rank(${alias}.tsv, query) DESC`);
	}
	return valid;
}

function filterSub(q, data, schema, alias) {
	q.select();
	var valid = whereSub(q, data, schema, alias);

	var orders = data.order || [];
	orders.push("updated_at");
	var seen = {};
	orders.forEach(function(order) {
		var {col, dir} = parseOrder('block', order);
		if (seen[col.column]) return;
		seen[col.column] = true;
		q.orderBy(col, dir);
	});
	q.offset(data.offset).limit(data.limit);
	return valid;
}

exports.find = function(req, data) {
	data.limit = 1;
	data.offset = 0;
	return exports.search(req, data).then(function(obj) {
		if (obj.items.length == 0) {
			throw new HttpError.NotFound("Block not found");
		}
		return {
			item: obj.items[0],
			metas: obj.metas
		};
	});
};
exports.find.schema = {
	title: 'Find one block',
	$action: 'read',
	required: ['type'],
	properties: Object.assign({}, exports.search.schema.properties)
};
delete exports.find.schema.properties.limit;
delete exports.find.schema.properties.offset;
exports.find.external = true;

exports.add = function({site}, data) {
	var parents = data.parents || [];
	delete data.parents;

	return site.$relatedQuery('children').insert(data).then(function(child) {
		if (parents.length == 0) return child;
		return site.$relatedQuery('children')
		.whereIn(['block.id', 'block.type'], parents.map(function(item) {
			if (!item.type || !item.id) throw new HttpError.BadRequest("Parents must have id, type");
			return [item.id, item.type];
		})).then(function(ids) {
			return child.$relatedQuery('parents', site.trx).relate(ids);
		}).then(function() {
			return child;
		});
	});
};
exports.add.schema = {
	title: 'Add a block',
	$action: 'add',
	required: ['type'],
	properties: {
		type: {
			title: 'type',
			type: 'string',
			format: 'id',
			$filter: {
				name: 'element',
				standalone: true,
				contentless: true
			}
		},
		parents: { // updated by element filter
			title: 'parents',
			type: 'array',
			nullable: true,
			$filter: 'relation'
		},
		data: { // updated by element filter
			title: 'data',
			type: 'object',
			nullable: true
		}
	}
};
exports.add.external = true;

exports.save = function(req, data) {
	return exports.get(req, data).forUpdate().then(function(block) {
		var obj ={
			type: block.type,
			data: data.data
		};
		if (data.lock) obj.lock = data.lock;
		return block.$query(req.site.trx).patchObject(obj).then(function() {
			if (!block) throw new Error(`Block not found for update ${data.id}`);
			return block;
		});
	});
};
exports.save.schema = {
	title: 'Modify a block',
	$action: 'save',
	required: ['id', 'type'],
	properties: {
		id: {
			title: 'id',
			type: 'string',
			format: 'id'
		},
		type: {
			title: 'type',
			type: 'string',
			format: 'id',
			$filter: {
				name: 'element',
				standalone: true,
				contentless: true
			}
		},
		data: {
			title: 'data',
			type: 'object',
			nullable: true
		},
		get lock() {
			return All.api.Block.jsonSchema.properties.lock;
		}
	}
};
exports.save.external = true;

exports.del = function({site}, data) {
	return site.$relatedQuery('children')
	.where('block.id', data.id)
	.where('block.type', data.type)
	.delete();
};
exports.del.schema = {
	title: 'Delete a block',
	$action: 'del',
	required: ['id', 'type'],
	properties: {
		id: {
			title: 'id',
			type: 'string',
			format: 'id'
		},
		type: {
			title: 'type',
			type: 'string',
			format: 'id',
			$filter: {
				name: 'element',
				standalone: true,
				contentless: true
			}
		}
	}
};
exports.del.external = true;

exports.write = function(req, data) {
	var list = data.operations;
	return Promise.all(list.map(function(op) {
		return All.run(`block.${op.method}`, req, op.item);
	}));
};

exports.write.schema = {
	title: 'Write multiple blocks',
	$action: 'write',
	required: ['operations'],
	properties: {
		operations: {
			title: 'Operations',
			type: 'array',
			items: {
				title: 'Operation',
				type: 'object',
				properties: {
					method: {
						title: 'Method',
						anyOf: [{
							const: 'add',
							title: 'Add'
						}, {
							const: 'save',
							title: 'Save'
						}, {
							const: 'del',
							title: 'Delete'
						}]
					},
					item: {
						title: 'Item',
						type: 'object'
					}
				}
			}
		}
	}
};
exports.write.external = true;


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

