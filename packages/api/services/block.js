const { ref, raw } = require('objection');
const Block = require('../models/block');
const { unflatten, mergeRecursive } = require('../../../lib/utils');

module.exports = class BlockService {
	static name = 'block';

	apiRoutes(app, server) {
		server.get("/.api/block", async (req, res) => {
			const data = await req.run('block.get', req.query);
			res.return(data);
		});

		server.get("/.api/blocks", async (req, res) => {
			const data = await req.run('block.search', unflatten(req.query));
			res.return(data);
		});

		server.post('/.api/blocks', app.auth.lock('writer'), async (req, res) => {
			const data = await req.run('block.write', req.body);
			res.return(data);
		});
	}

	get({ site, trx }, data) {
		const q = site.$relatedQuery('children', trx).select()
			.where('block.id', data.id);
		if (data.type) {
			q.where('block.type', data.type);
		}
		const eagers = {};
		if (data.parents) {
			eagers.parents = {
				$modify: ['withoutSite']
			};
		}
		if (data.children) {
			eagers.children = true;
		}
		if (!Object.isEmpty(eagers)) {
			q.withGraphFetched(eagers).modifiers({
				withoutSite(q) {
					q.whereNot('block.type', 'site');
				}
			});
		}
		return q.first().throwIfNotFound();
	}
	static get = {
		$action: 'read',
		required: ['id'],
		properties: {
			id: {
				title: 'id',
				type: 'string',
				format: 'id'
			},
			type: {
				title: 'type',
				type: 'string',
				format: 'name'
			},
			parents: {
				title: 'with parents',
				type: 'boolean',
				default: false
			},
			children: {
				title: 'with children',
				type: 'boolean',
				default: false
			}
		}
	};

	async search(req, data) {
		// TODO data.id or data.parent.id or data.child.id must be set
		// currently the check filterSub -> boolean is only partially applied
		const { site, trx, Block } = req;
		let parents = data.parents;
		if (parents) {
			if (parents.type || parents.id || parents.standalone) {
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
						if (!item.type) {
							throw new HttpError.BadRequest("Missing parents.item.type");
						}
						q.whereObject(item, item.type, alias);
					});
				}
				delete data.parent.parents;
			}
			if (Object.keys(data.parent).length) {
				if (!data.parent.type) {
					throw new HttpError.BadRequest("Missing parent.type");
				}
				valid = true;
				q.joinRelated('parents', { alias: 'parent' });
				q.whereObject(data.parent, data.parent.type, 'parent');
			}
		}
		if (data.child && Object.keys(data.child).length) {
			if (!data.child.type) {
				throw new HttpError.BadRequest("Missing child.type");
			}
			q.joinRelated('children', { alias: 'child' });
			q.whereObject(data.child, data.child.type, 'child');
		}
		const eagers = {};

		valid = filterSub(q, data) || valid;
		if (!valid) {
			throw new HttpError.BadRequest("Insufficient search parameters");
		}
		if (parents) {
			eagers.parents = {
				$modify: ['parentsFilter']
			};
		}

		if (children) {
			if (children.count) {
				const qchildren = { ...children };
				delete qchildren.count;
				delete qchildren.limit;
				delete qchildren.offset;
				const qc = site.$relatedQuery('children', trx).alias('children');
				whereSub(qc, qchildren, 'children');
				qc.joinRelated('parents', { alias: 'parents' })
					.where('parents._id', ref('block._id'));
				q.select(Block.query(trx).count().from(qc.as('sub')).as('itemsCount'));
			} else {
				eagers.items = {
					$relation: 'children',
					$modify: ['itemsFilter']
				};
			}
		}
		if (data.count) {
			// TODO
		}
		if (data.content) {
			eagers.items = {
				$relation: 'children',
				$modify: ['childrenFilter']
			};
		}
		if (!Object.isEmpty(eagers)) q.withGraphFetched(eagers).modifiers({
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

		const rows = await q;
		const obj = {
			items: rows,
			offset: data.offset,
			limit: data.limit
		};

		const ids = [];
		for (const row of rows) {
			ids.push(row.id);
			if (parents && parents.first) {
				if (row.parents && row.parents.length) {
					row.parent = row.parents[0];
				}
				delete row.parents;
			}
			if (children && children.first) {
				if (row.items && row.items.length) {
					row.child = row.items[0];
				}
				delete row.items;
			}
			if (!data.content) {
				delete row.content;
			}
		}
		if (ids.length) {
			const hrow = await req.call('href.collect', {
				ids,
				content: data.content,
				asMap: true
			}).first();
			obj.hrefs = hrow.hrefs;
		}
		return obj;
	}
	static search = {
		title: 'Search blocks',
		$action: 'read',
		external: true,
		required: ['type'],
		properties: {
			parent: {
				title: 'Select by parent',
				description: 'search blocks only having these parents',
				type: "object",
				nullable: true
			},
			child: {
				title: 'Select by child',
				description: 'search blocks only having these children',
				type: 'object',
				nullable: true
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

	async find(req, data) {
		data.limit = 1;
		data.offset = 0;
		const obj = await this.search(req, data);
		if (obj.items.length == 0) {
			throw new HttpError.NotFound("Block not found");
		}
		return {
			item: obj.items[0],
			hrefs: obj.hrefs
		};
	}
	static find = {
		title: 'Find one block',
		$action: 'read',
		external: true,
		required: ['type'],
		get properties() {
			const obj = { ...BlockService.search.properties };
			delete obj.limit;
			delete obj.offset;
			return obj;
		}
	};

	async clone({ site, run, trx, Block }, data) {
		const src = await run('block.get', {
			id: data.id,
			children: true,
			parents: true
		});
		const copy = {
			type: src.type,
			data: mergeRecursive({}, src.data, data.data),
			expr: mergeRecursive({}, src.expr, data.expr),
			content: mergeRecursive({}, src.content),
			locks: mergeRecursive({}, src.locks)
		};


		copy.parents = src.parents.map(({ _id }) => {
			return { "#dbRef": _id };
		});

		copy.children = await Promise.all(src.children.map(async child => {
			if (child.standalone) {
				return { "#dbRef": child._id };
			} else {
				delete child._id;
				delete child.id;
				await site.$beforeInsert.call(child);
				return child;
			}
		}));
		return site.$relatedQuery('children', trx)
			.insertGraph(copy, {
				allowRefs: true
			}).returning(Block.columns);
	}
	static clone = {
		title: 'Clone a block',
		$action: 'add',
		external: true,
		required: ['id'],
		properties: {
			id: {
				title: 'source',
				type: 'string',
				format: 'id',
				$helper: {
					name: 'block',
					filter: {
						standalone: true
					}
				}
			},
			parents: {
				title: 'parents',
				type: 'array',
				items: {
					type: 'object',
					properties: {
						type: {
							title: 'type',
							type: 'string',
							format: 'name',
							// semafor#convert only coerces empty strings to null if nullable
							// however it should just "undefine" empty strings
							nullable: true
						},
						id: {
							title: 'id',
							type: 'string',
							format: 'id',
							nullable: true
						}
					}
				},
				$filter: 'relation'
			},
			data: { // updated by element filter
				title: 'data',
				type: 'object',
				nullable: true
			},
			expr: {
				title: 'expr',
				type: 'object',
				nullable: true
			}
		}
	};

	async add({ site, trx, Block }, data) {
		const parents = data.parents ?? [];
		delete data.parents;

		const block = await site.$relatedQuery('children', trx)
			.insert(data).returning(Block.columns);

		const newParents = parents.filter(item => item.id != null)
			.map(item => [item.id, item.type]);

		if (newParents.length) {
			const ids = await site.$relatedQuery('children', trx)
				.whereIn(['block.id', 'block.type'], newParents);
			if (ids.length) {
				await block.$relatedQuery('parents', trx).relate(ids);
			}
		}
		return block;
	}
	static add = {
		title: 'Add a block',
		$action: 'add',
		external: true,
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
			parents: {
				title: 'parents',
				type: 'array',
				items: {
					type: 'object',
					properties: {
						type: {
							title: 'type',
							type: 'string',
							format: 'name',
							// semafor#convert only coerces empty strings to null if nullable
							// however it should just "undefine" empty strings
							nullable: true
						},
						id: {
							title: 'id',
							type: 'string',
							format: 'id',
							nullable: true
						}
					}
				},
				$filter: 'relation'
			},
			data: { // updated by element filter
				title: 'data',
				type: 'object',
				nullable: true
			},
			expr: {
				title: 'expr',
				type: 'object',
				nullable: true
			}
		}
	};

	async save(req, data) {
		const parents = data.parents ?? [];
		delete data.parents;

		const block = await this.get(req, data).forUpdate();
		if (!block) {
			throw new Error(`Block not found for update ${data.id}`);
		}
		const obj = {
			type: block.type
		};
		if (!Object.isEmpty(data.data)) obj.data = data.data;
		if (!Object.isEmpty(data.content)) obj.content = data.content;
		if (!Object.isEmpty(data.lock)) obj.lock = data.lock;
		await block.$query(req.trx).patchObject(obj);

		if (parents.length == 0) return block;

		await block.$relatedQuery('parents', req.trx)
			.whereIn('block.type', parents.map(item => item.type))
			.unrelate();

		const newParents = parents.filter(item => item.id != null)
			.map(item => [item.id, item.type]);

		if (newParents.length) {
			const ids = await req.site.$relatedQuery('children', req.trx)
				.whereIn(['block.id', 'block.type'], newParents);
			if (ids.length) {
				await block.$relatedQuery('parents', req.trx).relate(ids);
			}
		}
		return block;
	}
	static save = {
		title: 'Modify a block',
		$action: 'save',
		external: true,
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
					standalone: true
				}
			},
			data: {
				title: 'data',
				type: 'object',
				nullable: true
			},
			content: {
				title: 'content',
				type: 'object',
				nullable: true
			},
			expr: {
				title: 'expr',
				type: 'object',
				nullable: true
			},
			lock: Block.jsonSchema.properties.lock,
			parents: BlockService.add.properties.parents
		}
	};

	async del({ site, trx }, data) {
		return site.$relatedQuery('children', trx)
			.select(raw('recursive_delete(block._id, FALSE) AS count'))
			.where('block.id', data.id)
			.where('block.type', data.type).first().throwIfNotFound();
	}
	static del = {
		title: 'Delete a block',
		$action: 'del',
		external: true,
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

	async write(req, data) {
		const list = data.operations;
		return Promise.all(list.map((op) => {
			return req.run(`block.${op.method}`, op.item);
		}));
	}

	static write = {
		title: 'Write multiple blocks',
		$action: 'write',
		external: true,
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

	async fill({ site, run, trx }, { id, type, name, items = [] }) {
		const block = await run('block.get', { id });

		const contentIds = {};
		for (const [name, content = ''] of Object.entries(block.content ?? {})) {
			contentIds[name] = Array.from(content.matchAll(/block-id="([a-z0-9]+)"/g))
				.map(item => item[1]);
		}

		// keep only ids that are not used in other content
		let oldIds = contentIds[name]?.slice() ?? [];
		for (const [cn, list] of Object.entries(contentIds)) {
			if (name == cn) continue;
			for (let i = 0; i < oldIds.length; i++) {
				if (oldIds[i] != null && list.includes(oldIds[i])) oldIds[i] = null;
			}
		}
		oldIds = oldIds.filter(id => id != null);

		// delete non-standalone children
		await block.$relatedQuery('children', trx).delete()
			.whereIn('block.id', oldIds).where('block.standalone', false);
		// unrelate standalone children
		await block.$relatedQuery('children', trx).unrelate()
			.whereIn('block.id', oldIds).where('block.standalone', true);
		// insert children and build content
		items = items.filter(item => {
			if (type.includes(item.type) == false) return false;
			if (typeof item.content == "string") {
				item.content = { "": item.content };
			}
			return true;
		});
		const newItems = await site.$relatedQuery('children', trx)
			.insert(items).returning('*');
		// inserted items have id
		block.content[name] = newItems
			.map(item => `<div block-id="${item.id}"></div>`)
			.join('');
		await block.$relatedQuery('children', trx).relate(newItems);
		await block.$query(trx).patchObject({
			type: block.type,
			content: block.content
		});
		return block;
	}
	static fill = {
		title: 'Fill block content',
		$action: 'write',
		external: true,
		required: ['id'],
		properties: {
			id: {
				title: 'id',
				type: 'string',
				format: 'id'
			},
			type: {
				title: 'Allowed types',
				type: 'array',
				items: {
					type: 'string',
					format: 'name'
				}
			},
			name: {
				title: 'Content name',
				type: 'string',
				format: 'name'
			},
			items: {
				title: 'Items',
				type: 'array',
				items: {
					type: 'object'
				}
			}
		}
	};
};



function whereSub(q, data, alias = 'block') {
	let valid = false;
	const types = (data.type || []).filter(t => t != 'site');
	if (types.length) {
		valid = true;
		q.whereIn(`${alias}.type`, types);
	} else {
		q.whereNotIn(`${alias}.type`, ['user', 'site']);
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
	for (const order of orders) {
		const { col, dir } = parseOrder('block', order);
		if (seen[col.expression]) continue;
		seen[col.expression] = true;
		q.orderBy(col, dir);
	}
	q.offset(data.offset);
	if (data.limit != null) q.limit(data.limit);
	return valid;
}


async function gc({ trx }, days) {
	// this might prove useless
	const results = await trx.raw(`DELETE FROM block USING (
		SELECT count(relation.child_id), b._id FROM block AS b
			LEFT OUTER JOIN relation ON (relation.child_id = b._id)
			LEFT JOIN block AS p ON (p._id = relation.parent_id AND p.type='site')
		WHERE b.type NOT IN ('user', 'site') AND extract('day' from now() - b.updated_at) >= ?
		GROUP BY b._id
	) AS usage WHERE usage.count = 0 AND block._id = usage._id`, [
		days
	]);
	return {
		length: results.rowCount
	};
}

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

