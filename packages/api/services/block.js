const { ref, raw } = require('objection');

exports = module.exports = function () {
	return {
		name: 'block',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/block", (req, res, next) => {
		All.run('block.get', req, req.query).then((data) => {
			All.send(res, data);
		}).catch(next);
	});

	All.app.get("/.api/blocks", (req, res, next) => {
		All.run('block.search', req, All.utils.unflatten(req.query)).then((data) => {
			All.send(res, data);
		}).catch(next);
	});

	All.app.post('/.api/blocks', All.auth.lock('writer'), (req, res, next) => {
		All.run('block.write', req, req.body).then((data) => {
			All.send(res, data);
		}).catch(next);
	});
}

exports.get = function (req, data) {
	const q = req.site.$relatedQuery('children', req.trx).select()
		.where('block.id', data.id);
	if (data.type) q.where('block.type', data.type);
	if (data.standalone) q.withGraphFetched('[children(childrenFilter)]').modifiers({
		childrenFilter(query) {
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
			format: 'name'
		},
		standalone: {
			type: 'boolean',
			default: false
		}
	}
};

exports.search = function ({ site, trx }, data) {
	// TODO data.id or data.parent.id or data.child.id must be set
	// currently the check filterSub -> boolean is only partially applied

	let parents = data.parents;
	if (parents) {
		if (parents.type || parents.id) {
			// ok
		} else {
			parents = null;
		}
	}
	const children = data.children;
	let valid = false;
	const q = site.$relatedQuery('children', trx);
	if (data.parent) {
		const parentList = data.parent.parents;
		if (parentList && Array.isArray(parentList)) {
			if (parentList.length) {
				valid = true;
				parentList.forEach((item, i) => {
					const alias = 'parent_' + i;
					q.joinRelated('parents', { alias: alias });
					if (!item.type) throw new HttpError.BadRequest("Missing parents.item.type");
					q.whereObject(item, item.type, alias);
				});
			}
			delete data.parent.parents;
		}
		if (Object.keys(data.parent).length) {
			if (!data.parent.type) throw new HttpError.BadRequest("Missing parent.type");
			valid = true;
			q.joinRelated('parents', { alias: 'parent' });
			q.whereObject(data.parent, data.parent.type, 'parent');
		}
	}
	if (data.child && Object.keys(data.child).length) {
		if (!data.child.type) throw new HttpError.BadRequest("Missing child.type");
		q.joinRelated('children', { alias: 'child' });
		q.whereObject(data.child, data.child.type, 'child');
	}
	const eagers = [];

	valid = filterSub(q, data) || valid;
	if (!valid) throw new HttpError.BadRequest("Insufficient search parameters");
	if (parents) eagers.push('parents(parentsFilter) as parents');

	if (children) {
		if (children.count) {
			const qchildren = Object.assign({}, children);
			delete qchildren.count;
			delete qchildren.limit;
			delete qchildren.offset;
			const qc = site.$relatedQuery('children', trx).alias('children');
			whereSub(qc, qchildren, 'children');
			qc.joinRelated('parents', { alias: 'parents' })
				.where('parents._id', ref('block._id'));
			q.select(All.api.Block.query(trx).count().from(qc.as('sub')).as('itemsCount'));
		} else {
			eagers.push('children(itemsFilter) as items');
		}
	}
	if (data.count) {
		// TODO
	}
	if (data.content) {
		eagers.push('children(childrenFilter) as children');
	}
	if (eagers.length) q.withGraphFetched(`[${eagers.join(',')}]`).modifiers({
		parentsFilter(query) {
			filterSub(query, parents);
		},
		itemsFilter(query) {
			filterSub(query, children);
			if (!children.type) {
				// FIXME this is for backward compatibility
				query.where('standalone', true);
			}
		},
		childrenFilter(query) {
			query.select().where('standalone', false);
		}
	});

	return q.then((rows) => {
		const obj = {
			items: rows,
			offset: data.offset,
			limit: data.limit
		};

		const ids = [];
		rows.forEach((row) => {
			ids.push(row.id);
			if (parents && parents.first) {
				if (row.parents && row.parents.length) row.parent = row.parents[0];
				delete row.parents;
			}
			if (children && children.first) {
				if (row.items && row.items.length) row.child = row.items[0];
				delete row.items;
			}
			if (!data.content) delete row.content;
		});
		if (!ids.length) return obj;
		return All.href.collect({ site, trx }, {
			id: ids,
			content: data.content
		}).first().then((hrow) => {
			obj.hrefs = hrow.hrefs;
			return obj;
		});
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
			type: 'array',
			items: {
				type: 'string',
				format: 'name'
			},
			$filter: {
				name: 'element',
				standalone: true,
				contentless: true,
				multiple: true
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
			type: 'object',
			nullable: true
		},
		content: {
			title: 'Content',
			type: 'boolean',
			default: false
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
			nullable: true
		},
		offset: {
			title: 'Offset',
			type: 'integer',
			minimum: 0,
			default: 0
		},
		count: {
			title: 'Count',
			type: 'boolean',
			default: false
		},
		parents: {
			title: 'Parents',
			type: 'object',
			nullable: true,
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
					nullable: true,
					type: 'array',
					items: {
						type: 'string',
						format: 'name'
					},
					$filter: {
						name: 'element',
						standalone: true,
						contentless: true,
						multiple: true
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
					type: 'object',
					nullable: true
				},
				content: {
					title: 'Content',
					type: 'boolean',
					default: false
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
					nullable: true
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
			nullable: true,
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
					nullable: true,
					type: 'array',
					items: {
						type: 'string',
						format: 'name'
					},
					$filter: {
						name: 'element',
						standalone: true,
						contentless: true,
						multiple: true
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
					type: 'object',
					nullable: true
				},
				content: {
					title: 'Content',
					type: 'boolean',
					default: false
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
					nullable: true
				},
				offset: {
					title: 'Offset',
					type: 'integer',
					minimum: 0,
					default: 0
				},
				count: {
					title: 'Count',
					type: 'boolean',
					default: false
				}
			}
		}
	}
};
exports.search.external = true;

function whereSub(q, data, alias = 'block') {
	let valid = false;
	const types = (data.type || []).filter(t => t != 'site');
	if (types.length) {
		valid = true;
		q.whereIn(`${alias}.type`, types);
	}
	if (data.standalone != null) {
		q.where(`${alias}.standalone`, data.standalone);
	}
	if (data.id) {
		valid = true;
		q.where(`${alias}.id`, data.id);
	}
	if (data.data && Object.keys(data.data).length > 0) {
		valid = true;
		q.whereObject({ data: data.data }, data.type, alias);
	}
	if (data.text) {
		valid = true;
		q.from(raw("websearch_to_tsquery('unaccent', ?) AS query, ??", [data.text, alias]));
		q.whereRaw(`query @@ ${alias}.tsv`);
		q.orderByRaw(`ts_rank(${alias}.tsv, query) DESC`);
	}
	return valid;
}

function filterSub(q, data, alias) {
	q.select();
	const valid = whereSub(q, data, alias);

	const orders = data.order || [];
	orders.push("updated_at");
	const seen = {};
	orders.forEach((order) => {
		const { col, dir } = parseOrder('block', order);
		if (seen[col.expression]) return;
		seen[col.expression] = true;
		q.orderBy(col, dir);
	});
	q.offset(data.offset);
	if (data.limit != null) q.limit(data.limit);
	return valid;
}

exports.find = function (req, data) {
	data.limit = 1;
	data.offset = 0;
	return exports.search(req, data).then((obj) => {
		if (obj.items.length == 0) {
			throw new HttpError.NotFound("Block not found");
		}
		return {
			item: obj.items[0],
			hrefs: obj.hrefs
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

exports.add = function ({ site, trx }, data) {
	const parents = data.parents || [];
	delete data.parents;

	return site.$relatedQuery('children', trx).insert(data).then((child) => {
		if (parents.length == 0) return child;
		return site.$relatedQuery('children', trx)
			.whereIn(['block.id', 'block.type'], parents.map((item) => {
				if (!item.type || !item.id) throw new HttpError.BadRequest("Parents must have id, type");
				return [item.id, item.type];
			})).then((ids) => {
				return child.$relatedQuery('parents', trx).relate(ids);
			}).then(() => {
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
			format: 'name',
			$filter: {
				name: 'element',
				standalone: true,
				contentless: true
			}
		},
		parents: { // updated by element filter
			title: 'parents',
			type: 'array',
			items: [{
				type: 'object',
				properties: {
					type: {
						title: 'type',
						type: 'string',
						format: 'name'
					},
					id: {
						title: 'id',
						type: 'string',
						format: 'id'
					}
				}
			}],
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

exports.save = function (req, data) {
	return exports.get(req, data).forUpdate().then((block) => {
		const obj = {
			type: block.type
		};
		if (data.data && Object.keys(data.data).length) obj.data = data.data;
		if (data.lock && Object.keys(data.lock).length) obj.lock = data.lock;
		return block.$query(req.trx).patchObject(obj).then(() => {
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
			format: 'name',
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

exports.del = function ({ site, trx }, data) {
	return site.$relatedQuery('children', trx)
		.select(raw('recursive_delete(block._id, FALSE) AS count'))
		.where('block.id', data.id)
		.where('block.type', data.type).first().throwIfNotFound();
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
			format: 'name',
			$filter: {
				name: 'element',
				standalone: true,
				contentless: true
			}
		}
	}
};
exports.del.external = true;

exports.write = function (req, data) {
	const list = data.operations;
	return Promise.all(list.map((op) => {
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


exports.gc = function ({ trx }, days) {
	// this might prove useless
	return trx.raw(`DELETE FROM block USING (
		SELECT count(relation.child_id), b._id FROM block AS b
			LEFT OUTER JOIN relation ON (relation.child_id = b._id)
			LEFT JOIN block AS p ON (p._id = relation.parent_id AND p.type='site')
		WHERE b.type NOT IN ('user', 'site') AND extract('day' from now() - b.updated_at) >= ?
		GROUP BY b._id
	) AS usage WHERE usage.count = 0 AND block._id = usage._id`, [
		days
	]).then((result) => {
		return {
			length: result.rowCount
		};
	});
};

function parseOrder(table, str) {
	let col = str;
	let dir = 'asc';
	if (col.startsWith('-')) {
		dir = 'desc';
		col = col.substring(1);
	}
	const list = col.split('.');
	const first = list.shift();
	col = `${table}.${first}`;
	if (list.length > 0) col += `:${list.join('.')}`;
	return { col: ref(col), dir };
}

