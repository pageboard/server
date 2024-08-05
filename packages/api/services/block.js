const Block = require('../models/block');
const { mergeRecursive, dget } = require('../../../src/utils');

module.exports = class BlockService {
	static name = 'block';

	constructor(app) {
		this.app = app;
	}

	apiRoutes(app) {
		app.get("/@api/block/get", 'block.get');
		app.get("/@api/block/search", 'block.search');
		app.post('/@api/block/write', 'block.write');
		app.post('/@api/block/del', 'block.del');
	}

	get(req, data) {
		const { lang } = req.call('translate.lang', data);
		const q = req.site.$relatedQuery('children', req.trx)
			.columns({
				lang,
				content: null
			})
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
			eagers.children = {
				$modify: ['withoutContent']
			};
		}
		if (!Object.isEmpty(eagers)) {
			q.withGraphFetched(eagers).modifiers({
				withoutSite(q) {
					q.whereNot('block.type', 'site');
				},
				withoutContent(q) {
					q.whereNot('block.type', 'content');
				}
			});
		}
		return q.first().throwIfNotFound();
	}
	static get = {
		title: 'Get',
		$action: 'read',
		$private: true,
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
			},
			lang: {
				title: 'Select site language',
				type: 'string',
				format: 'lang',
				nullable: true
			}
		}
	};

	async search(req, data) {
		const { site, trx, ref, raw, fun, Block, Href } = req;
		const language = req.call('translate.lang', data);
		let { parents } = data;
		if (parents) {
			if (parents.type || parents.id || parents.standalone) {
				parents.lang = language.lang;
			} else {
				parents = null;
			}
		}
		const { children } = data;
		let valid = false;
		const q = site.$relatedQuery('children', trx);

		if (data.parent) {
			const parentList = data.parent.parents;
			// this is internal API and instead it should be
			// an array of data.parent
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
				if (!data.parent.type?.length) {
					if (parents?.type?.length) {
						data.parent.type = parents.type;
					} else {
						throw new HttpError.BadRequest("Missing parent.type");
					}
				}
				valid = true;
				q.joinRelated('parents', { alias: 'parent' });
				const pc = data.parent.content; // whereObject fails otherwise
				delete data.parent.content;
				whereSub(q, data.parent, 'parent');
				data.parent.content = pc;
			} else {
				delete data.parent;
			}
		}

		if (language.lang && children) {
			children.lang = language.lang;
		}

		if (data.child && Object.keys(data.child).length) {
			if (data.text) {
				throw new HttpError.BadRequest("Cannot join by child and search by text");
			}
			if (!data.child.type?.length) {
				if (children?.type?.length) {
					data.child.type = children.type;
				} else {
					throw new HttpError.BadRequest("Missing child.type");
				}
			}
			q.joinRelated('children', { alias: 'child' });
			q.whereObject(data.child, data.child.type, 'child');
		} else if (data.text) {
			if (data.text.endsWith('*')) q.with('search', Block.query(trx)
				.select(ref('to_tsquery').as('query'))
				.from(raw(`to_tsquery('unaccent', :text)`, {
					text: data.text.replace(/\*$/, ':*')
				}))
			);
			else q.with('search', Block.query(trx)
				.select(ref('websearch_to_tsquery').as('query'))
				.from(raw(`websearch_to_tsquery(:tsconfig, :text)`, {
					text: data.text,
					tsconfig: language.tsconfig
				}))
			);
			if (language.lang) {
				q.with('contents', Block.query(trx)
					.select(
						'block._id', 'children.tsv',
						ref('children.data:text').castText().as('text')
					)
					.joinRelated('children')
					.where('children.type', 'content')
					.where(ref('children.data:lang').castText(), language.lang)
					.where(q => {
						if (data.content?.length) {
							q.whereIn(ref('children.data:name').castText(), data.content);
						}
					})
				);
			} else {
				q.with('contents', Block.query(trx)
					.select('block._id', 'block.tsv', 'value AS text')
					.from(raw('block, jsonb_each_text(block.content)'))
					.where(q => {
						if (data.content.length) {
							q.whereIn('name', data.content);
						}
					})
				);

			}

			const qdoc = Block.query(trx).select('block._id')
				.select(fun.sum(raw('ts_rank(contents.tsv, search.query)')).as('rank'))
				.select(raw(
					`array_remove(array_agg(DISTINCT content_get_headline(:tsconfig, contents.text, search.query)), NULL) AS headlines`, language
				))
				.groupBy('block._id');
			if (data.content?.length) {
				// find blocks by their direct content
				qdoc.join('contents', 'block._id', 'contents._id')
					.join('search', 'contents.tsv', '@@', 'search.query');
			} else {
				// find blocks by direct content and textblock children contents
				// TODO add search by direct content (lateral join or something)
				qdoc.joinRelated('children as child')
					.whereIn('child.type', site.$pkg.textblocks)
					.join('contents', 'child._id', 'contents._id')
					.join('search', 'contents.tsv', '@@', 'search.query');
			}

			q.with('doc', qdoc)
				.join('doc', 'block._id', 'doc._id')
				.select(raw('headlines[:3]'))
				.select('rank').orderBy('rank', 'desc');
		}
		const eagers = {};

		valid = filterSub(q, data, language) || valid;
		if (!valid) {
			throw new HttpError.BadRequest("Insufficient search parameters");
		}

		if (parents) {
			if (parents.count) {
				const qc = site.$relatedQuery('children', trx).alias('parents');
				whereSub(qc, parents, 'parents');
				qc.joinRelated('children', { alias: 'children' })
					.where('children._id', ref('block._id'));
				q.select(
					Block.query(trx).count().from(qc.as('sub')).as('parents_count')
				);
			} else {
				eagers.parents = {
					$relation: 'parents',
					$modify: ['parentsFilter']
				};
			}
		}

		if (children) {
			if (children.count) {
				const qc = site.$relatedQuery('children', trx).alias('children');
				whereSub(qc, children, 'children');
				qc.joinRelated('parents', { alias: 'parents' })
					.where('parents._id', ref('block._id'));
				q.select(
					Block.query(trx).count().from(qc.as('sub')).as('children_count')
				);
			} else {
				eagers.items = {
					$relation: 'children',
					$modify: ['itemsFilter']
				};
			}
		}
		const hasComplexContent = (data.content == null || data.content.length) && data.type.some(type => {
			const { contents = [] } = site.$schema(type);
			return contents.some(
				({ id, nodes }) => (data.content == null || data.content.includes(id)) && nodes != "text*"
			);
		});

		if (hasComplexContent) eagers.children = {
			$relation: 'children',
			$modify: ['childrenFilter']
		};

		if (!Object.isEmpty(eagers)) q.withGraphFetched(eagers).modifiers({
			parentsFilter(query) {
				filterSub(query, parents, language);
			},
			itemsFilter(query) {
				filterSub(query, children, language);
				if (!children.type) {
					// FIXME this is for backward compatibility
					query.where('standalone', true);
				}
			},
			childrenFilter(query) {
				query.columns({ lang: language.lang })
					.where('standalone', false)
					.whereNot('type', 'content');
			}
		});

		const [rows, count] = await Promise.all([
			q,
			q.clone().resultSize()
		]);
		for (const type of data.type) {
			req.types.add(type);
		}

		const ids = [];
		for (const row of rows) {
			ids.push(row.id);
			if (parents?.count || children?.count) {
				row.count = {};
				if (row.children_count != null) {
					row.count.children = row.children_count;
					delete row.children_count;
				}
				if (row.parents_count != null) {
					row.count.parents = row.parents_count;
					delete row.parents_count;
				}
			}
			if (parents?.first) {
				if (row.parents && row.parents.length) {
					row.parent = row.parents[0];
				}
				delete row.parents;
			}
			if (children?.first) {
				if (row.items && row.items.length) {
					row.child = row.items[0];
				}
				delete row.items;
			}
		}

		const obj = {
			count,
			offset: data.offset,
			limit: data.limit,
			items: rows
		};
		if (language.lang) obj.lang = language.lang;
		if (data.parent?.type?.length) obj.item = (await this.find(req, {
			...data.parent,
			lang: language.lang
		})).item;
		if (ids.length) {
			obj.hrefs = await req.run('href.collect', {
				ids,
				content: hasComplexContent,
				asMap: true,
				preview: data.preview,
				types: Href.mediaTypes
			});
		} else {
			obj.hrefs = {};
		}
		return obj;
	}
	static search = {
		title: 'Search',
		$action: 'read',
		required: ['type'],
		properties: {
			id: {
				title: 'Select by ids',
				type: 'array',
				nullable: true,
				items: {
					type: 'string',
					format: 'id'
				}
			},
			type: {
				title: 'Select by types',
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
			preview: {
				title: 'Preview',
				type: 'boolean',
				nullable: true
			},
			text: {
				title: 'Text search',
				type: "string",
				format: "singleline",
				nullable: true
			},
			data: {
				title: 'Select by data',
				type: 'object',
				nullable: true
			},
			created_at: {
				title: 'Created at',
				type: 'string',
				nullable: true
			},
			updated_at: {
				title: 'Updated at',
				type: 'string',
				nullable: true
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
				default: 0
			},
			lang: {
				title: 'Language',
				type: 'string',
				format: 'lang',
				nullable: true,
				$helper: {
					name: 'datalist',
					url: '/@api/translate/languages'
				}
			},
			content: {
				title: 'Contents',
				type: 'array',
				nullable: true,
				items: {
					type: 'string',
					format: 'name',
					title: 'Custom',
				},
				$filter: {
					name: 'element-content'
				}
			},
			parent: {
				title: 'Filter by parent',
				type: "object",
				nullable: true,
				properties: {
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
						title: 'Select by types',
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
					data: {
						title: 'Select by data',
						type: 'object',
						nullable: true
					},
					content: {
						title: 'Contents',
						type: 'array',
						nullable: true,
						items: {
							type: 'string',
							format: 'name',
							title: 'Custom',
						},
						$filter: {
							name: 'element-content'
						}
					},
					parents: {
						// internal api
						type: 'array',
						items: {
							type: 'object'
						}
					}
				}
			},
			child: {
				title: 'Filter by child',
				type: "object",
				nullable: true,
				properties: {
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
						title: 'Select by types',
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
					data: {
						title: 'Select by data',
						type: 'object',
						nullable: true
					}
				}
			},
			parents: {
				title: 'Fetch parents',
				type: 'object',
				nullable: true,
				properties: {
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
						title: 'Select by types',
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
					first: {
						title: 'Single',
						type: 'boolean',
						nullable: true
					},
					data: {
						title: 'Select by data',
						type: 'object',
						nullable: true
					},
					order: {
						title: 'Sort by',
						type: 'array',
						items: {
							type: 'string',
							format: 'singleline'
						}
					},
					count: {
						title: 'Count parents',
						type: 'boolean',
						default: false
					},
					content: {
						title: 'Contents',
						type: 'array',
						nullable: true,
						items: {
							type: 'string',
							format: 'name',
							title: 'Custom',
						},
						$filter: {
							name: 'element-content'
						}
					}
				}
			},
			children: {
				title: 'Fetch children',
				type: 'object',
				nullable: true,
				properties: {
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
						title: 'Select by types',
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
					first: {
						title: 'Single',
						type: 'boolean',
						default: false
					},
					data: {
						title: 'Select by data',
						type: 'object',
						nullable: true
					},
					order: {
						title: 'Sort by',
						type: 'array',
						items: {
							type: 'string',
							format: "singleline"
						}
					},
					count: {
						title: 'Count children',
						type: 'boolean',
						default: false
					},
					content: {
						title: 'Contents',
						type: 'array',
						nullable: true,
						items: {
							type: 'string',
							format: 'name',
							title: 'Custom',
						},
						$filter: {
							name: 'element-content'
						}
					}
				}
			}
		},
		templates: {
			lang: '[$lang]',
			offset: '[$query.offset?]'
		}
	};

	async find(req, data) {
		data.limit = 1;
		data.offset = 0;
		const obj = await this.search(req, data);
		const ret = { hrefs: obj.hrefs, lang: obj.lang };
		if (obj.items.length == 0) ret.status = 404;
		else ret.item = obj.items[0];
		return ret;
	}
	static find = {
		title: 'Find',
		$action: 'read',
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
			lock: mergeRecursive([], src.lock)
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
		title: 'Clone',
		$action: 'write',
		required: ['id'],
		properties: {
			id: {
				...Block.jsonSchema.properties.id,
				$helper: {
					name: 'block',
					filter: {
						standalone: true
					}
				}
			},
			parents: Block.jsonSchemaParents,
			data: Block.jsonSchema.properties.data,
			// content ?
			expr: Block.jsonSchema.properties.expr // not sure it's useful
		}
	};

	async add(req, data) {
		const { site, Block, trx } = req;
		const obj = {
			type: data.type
		};
		if (data.id) obj.id = data.id;
		obj.data = data.data ?? {};
		if (!Object.isEmpty(data.content)) obj.content = data.content;
		if (data.lock !== undefined) {
			if (req.locked(data.lock ?? [])) {
				throw HttpError.Unauthorized("Missing permissions to set locks");
			} else {
				obj.lock = data.lock;
			}
		}
		const parents = data.parents ?? [];

		const block = await site.$relatedQuery('children', trx)
			.insert(obj).returning(Block.columns);

		block.content ??= {};

		const newParents = parents.filter(item => item.id != null)
			.map(item => [item.id, item.type]);

		if (newParents.length) {
			const ids = await site.$relatedQuery('children', trx)
				.whereIn(['block.id', 'block.type'], newParents);
			if (ids.length) {
				await block.$relatedQuery('parents', trx).relate(ids);
			}
		}
		return { item: block };
	}
	static add = {
		title: 'Add',
		description: 'Standalone block type only',
		$action: 'write',
		required: ['type'],
		properties: {
			id: Block.jsonSchema.properties.id,
			type: {
				...Block.jsonSchema.properties.type,
				$filter: {
					name: 'element',
					standalone: true
				}
			},
			data: Block.jsonSchema.properties.data,
			content: Block.jsonSchema.properties.content,
			parents: Block.jsonSchemaParents,
			lock: Block.jsonSchema.properties.lock
		}
	};

	async save(req, data) {
		const block = await this.get(req, { ...data, type: null }).forUpdate();
		if (!block) {
			throw new HttpError.NotFound(`Block not found for update ${data.id}`);
		}
		if (data.type != block.type) {
			throw new HttpError.BadRequest(
				`Cannot change block type ${block.type} to ${data.type}`
			);
		}
		const obj = {
			type: block.type
		};

		if (!Object.isEmpty(data.data)) obj.data = data.data;
		if (!Object.isEmpty(data.content)) obj.content = data.content;

		if (data.lock !== undefined) {
			if (req.locked(data.lock ?? []) || req.locked(block.lock ?? [])) {
				throw HttpError.Unauthorized("Missing permissions to change locks");
			} else {
				obj.lock = data.lock;
			}
		}
		await block.$query(req.trx).patchObject(obj);

		return {
			item: block
		};
	}
	static save = {
		title: 'Save',
		description: 'Standalone block type only',
		$action: 'write',
		required: ['id', 'type'],
		properties: {
			id: Block.jsonSchema.properties.id,
			type: {
				...Block.jsonSchema.properties.type,
				$filter: {
					name: 'element',
					standalone: true
				}
			},
			data: Block.jsonSchema.properties.data,
			content: Block.jsonSchema.properties.content,
			lock: Block.jsonSchema.properties.lock
		}
	};

	async del({ site, trx, fun, ref }, data) {
		const types = data.type ? [data.type] : site.$pkg.standalones;
		const row = await site.$relatedQuery('children', trx)
			.select(fun('recursive_delete', ref('block._id'), site.$pkg.standalones).as('count'))
			.where('block.id', data.id)
			.whereIn('block.type', types).first();
		return { count: row?.count ?? 0 };
	}
	static del = {
		title: 'Delete',
		description: 'Recursive delete of standalone block',
		$action: 'write',
		required: ['id'],
		properties: {
			id: Block.jsonSchema.properties.id,
			type: {
				...Block.jsonSchema.properties.type,
				$filter: {
					name: 'element',
					standalone: true
				}
			}
		}
	};

	async write(req, data) {
		const list = data.operations;
		return Promise.all(list.map(op => {
			return req.run(`block.${op.method}`, op.item);
		}));
	}

	static write = {
		title: 'Write many',
		$action: 'write',
		$private: true,
		$lock: 'webmaster',
		$tags: ['data-:site'],
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

	async fill({ site, run, trx }, { id, type = [], name, items = [] }) {
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
			if (type.length && type.includes(item.type) == false) return false;
			if (typeof item.content == "string") {
				item.content = { "": item.content };
			}
			return true;
		});

		const newItems = items.length
			? await site.$relatedQuery('children', trx).insert(items).returning('*')
			: items;
		// inserted items have id
		block.content[name] = newItems
			.map(item => `<div block-id="${item.id}"></div>`)
			.join('');
		block.children = newItems;
		if (items.length) await block.$relatedQuery('children', trx).relate(newItems);
		// safe with content update trigger
		await block.$query(trx).patch({
			type: block.type,
			content: block.content
		});
		return { item: block };
	}
	static fill = {
		title: 'Fill content',
		$action: 'write',
		required: ['id', 'type'],
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
	const types = typeof data.type == "string" && [data.type] || data.type || [];
	if (types.length) {
		valid = true;
		q.whereIn(`${alias}.type`, types);
	} else {
		q.whereNotIn(`${alias}.type`, ['user', 'site']);
	}
	if (data.standalone != null) {
		q.where(`${alias}.standalone`, data.standalone);
	}
	const wobj = {};
	for (const key of ['id', 'created_at', 'updated_at']) {
		if (data[key] !== undefined) wobj[key] = data[key];
	}
	if (!Object.isEmpty(data.data)) {
		wobj.data = data.data;
	}
	if (!Object.isEmpty(wobj)) {
		valid = true;
		// add the generic block style
		q.whereObject(wobj, types.concat(['*']), alias);
	}
	return valid;
}

function filterSub(q, data, language) {
	q.columns({ lang: language.lang, content: data.content });
	const valid = whereSub(q, data);
	const orders = data.order || [];
	orders.push('created_at');
	const seen = {};
	let group = { list: [] };
	const groups = [group];
	for (const order of orders) {
		const { col, dir } = parseOrder(q, 'block', order);
		group.dir ??= dir;
		if (seen[col.expression]) continue;
		seen[col.expression] = true;
		const val = dget(data, order);
		if (Array.isArray(val)) {
			group.sql = q.raw(
				'array_position(??, ?) ' + dir,
				q.val(val).asArray().castTo('text[]'),
				q.ref(col).castText()
			);
			group = { list: [] };
			groups.push(group);
		} else {
			if (dir != group.dir) {
				group = { dir, list: [] };
				groups.push(group);
			}
			group.list.push(col);
		}
	}
	for (const { sql, list, dir } of groups) {
		if (sql) {
			q.orderByRaw(sql);
		} else if (list.length == 1) {
			q.orderBy(list[0], dir);
		} else if (list.length > 1) {
			let args;
			if (list.every(item => item.isPlainColumnRef)) {
				args = list;
			} else {
				args = list.map(col => col.castText());
			}
			q.orderBy(Block.fn.coalesce(...args), dir);
		}
	}
	if (data.limit != null) {
		if (data.offset < 0) {
			data.limit += data.offset;
			data.offset = 0;
			if (data.limit < 0) {
				throw new HttpError.BadRequest("limit cannot be negative");
			}
		}
		q.offset(data.offset).limit(data.limit);
	}
	return valid;
}

function parseOrder(q, table, str) {
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
	return { col: q.ref(col), dir };
}

