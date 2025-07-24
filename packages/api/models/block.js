const common = require('./common');
const { Model } = common;
const { dget, merge } = require('../../../src/utils');
const crypto = require('node:crypto');

class Block extends Model {
	static useLimitInFirst = true;

	static tableName = 'block';

	static idColumn = '_id';

	static jsonSchemaParents = {
		title: 'parents',
		type: 'array',
		items: {
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
		},
		$filter: 'relation'
	};

	static jsonSchema = {
		type: 'object',
		$id: '/elements',
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
			data: {
				title: 'data',
				type: 'object',
				additionalProperties: true,
				nullable: true
			},
			expr: {
				title: 'expr',
				type: 'object',
				additionalProperties: true,
				nullable: true
			},
			content: {
				title: 'content',
				type: 'object',
				nullable: true,
				additionalProperties: { type: 'string' }
			},
			standalone: { // a standalone block can have 0 or multiple parents
				type: 'boolean',
				default: false
			},
			created_at: {
				format: 'date-time',
				type: 'string'
			},
			updated_at: {
				format: 'date-time',
				type: 'string'
			},
			lock: {
				type: 'array',
				nullable: true,
				items: {
					type: 'string',
					format: 'grant'
				},
				uniqueItems: true
			}
		}
	};

	// _id is removed in $formatJson
	static columns = [
		...Object.keys(this.jsonSchema.properties),
		'_id'
	];

	static elementToSchema(el) {
		const blockProps = this.jsonSchema.properties;
		const ElementKeywords = [
			'$lock',
			'parents',
			'upgrade',
			'templates',
			'group'
		];
		const {
			standalone, properties, required = [], contents, name, unique
		} = el;
		if (!name) {
			throw new Error("Missing element name: " + JSON.stringify(el));
		}
		const schema = {
			type: 'object',
			properties: {}
		};

		const standProp = standalone
			? { standalone: { ...blockProps.standalone, default: true } }
			: {};

		const dataSchema = properties ? {
			type: 'object',
			properties,
			required,
			unique
		} : {
			type: 'null'
		};
		if (el.additionalProperties != null) {
			dataSchema.additionalProperties = el.additionalProperties;
		}
		const contentSchema = contents ? {
			type: 'object',
			properties: contentsNames(contents),
			additionalProperties: contents.length == 0 ? true : false
		} : {
			type: 'null'
		};
		for (const p of ElementKeywords) {
			if (el[p] != null) schema[p] = el[p];
		}
		Object.assign(schema.properties, blockProps, standProp, {
			type: { const: name },
			data: dataSchema,
			content: contentSchema
		});
		return schema;
	}

	static genId() {
		// similar function defined in pageboard-write#store.js
		return crypto.randomBytes(10).toString('base64').slice(0, 14)
			.replace(/={1,2}$/, '')
			.replaceAll(/[/+]/g, () => {
				return String.fromCharCode(Math.round(Math.random() * 25) + 97);
			});
	}

	static QueryBuilder = class BlockQueryBuilder extends common.QueryBuilder {
		whereSite(siteId) {
			return this.joinRelated('parents')
				.where('parents.type', 'site')
				.where('parents.id', siteId);
		}
	};

	static normalizeContentSpec(contents) {
		if (!contents) return;
		if (contents === true) return [];
		if (typeof contents == "string") contents = {
			nodes: contents
		};
		if (!Array.isArray(contents)) {
			if (contents.spec) {
				contents = { ...contents };
				contents.nodes = contents.spec;
				delete contents.spec;
			}
			if (!contents.nodes && !contents.id) {
				throw new Error("Unsupported element contents:\n" + JSON.stringify(contents));
			} else {
				contents = [contents];
			}
		}
		return contents;
	}

	static createNotFoundError = function(data) {
		return new HttpError.NotFound("Block not found");
	};

	static relationMappings = {
		children: {
			relation: Model.ManyToManyRelation,
			modelClass: this,
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
			modelClass: this,
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

	static initSite(block, pkg, commons) {
		const {
			eltsMap, groups, tag,
			standalones, textblocks, hashtargets
		} = pkg;
		if (!block.id) {
			throw new Error("missing block.id\n" + JSON.stringify(block));
		}
		const types = {};
		const elements = {
			$id: Block.jsonSchema.$id,
			definitions: types,
			type: 'object',
			discriminator: { propertyName: "type" },
			required: ['type'],
			oneOf: []
		};
		const hrefs = {};
		const csps = {};

		// rootSchema has already been merged into eltsMap
		for (const [type, element] of Object.entries(eltsMap)) {
			const hrefsList = [];
			findHrefs(element, hrefsList);
			mergeCSP(csps, commons, element);
			if (hrefsList.length) hrefs[type] = hrefsList;
			types[type] = Block.elementToSchema(element);
			elements.oneOf.push({ $ref: `#/definitions/${type}` });
		}
		for (const key of Object.keys(csps)) {
			const list = csps[key];
			if (list?.length) csps[key] = csps[key].join(' ');
			else delete csps[key];
		}

		class DomainBlock extends Block {
			static relationMappings = cloneRelationMappings(this, Block);
			static uniqueTag() {
				return this.jsonSchema.$id;
			}
			static jsonSchema = elements;

			static #types = types;
			static schema(path) {
				if (path == "*") return Block.jsonSchema;
				const list = path.split('.');
				const type = list.shift();
				let sch = this.#types[type];
				if (list.length == 0 && sch) sch.name = type;
				for (let i = 0; i < list.length; i++) {
					sch = sch.properties?.[list[i]];
					if (!sch) throw new Error("Schema not found: " + path);
				}
				return sch;
			}

			$schema(type = this.type) {
				if (!type) return;
				return DomainBlock.schema(type);
			}

			#pkg = {
				bundles: new Map(),
				standalones: Array.from(standalones),
				groups,
				textblocks: Array.from(textblocks),
				hashtargets: Array.from(hashtargets),
				hrefs,
				csps,
				tag,
				dir: pkg.dir,
				migrations: {}
			};

			get $pkg() {
				return this.#pkg;
			}
			$clone(opts) {
				const copy = super.$clone(opts);
				Object.assign(copy.#pkg, this.#pkg);
				return copy;
			}
			async #uniqueProperty(context, opt = {}) {
				if (!this.type) {
					console.warn("Missing type, skipping #uniqueProperty", this);
					return;
				}
				const { req: { sql, site } } = context.transaction;
				const el = this.$schema();
				const uniques = [];
				const groupSchema = el.group ? DomainBlock.schema(el.group) : null;
				const { unique: groupUnique } = groupSchema?.properties?.data ?? {};
				if (groupUnique) {
					uniques.push({
						fields: groupUnique,
						types: Array.from(site.$pkg.groups[el.group])
					});
				}
				const { unique } = el?.properties?.data ?? {};
				if (unique) {
					const fields = unique.filter(field => {
						return !uniques.some(item => {
							return item.fields.includes(field);
						});
					});
					if (fields.length) uniques.push({ fields, types: [this.type] });
				}
				if (!uniques.length) return;
				const q = this.type == "site"
					? this.$modelClass.query(sql.trx)
					: site.$relatedQuery('children', sql.trx);
				const id = opt.old?.id ?? this.id;
				if (id != null) q.whereNot('block.id', id);
				const list = [];
				const conditions = [];
				for (const { fields, types } of uniques) {
					const cfields = [];
					for (const field of fields) {
						const key = `data.${field}`;
						const val = dget(opt.old || this, key);
						if (Array.isArray(val) && val.length == 0) continue;
						if (val == null) {
							if (val === undefined && opt.patch) continue;
							const parent = dget(el.properties, key.split('.').join('.properties.'));
							if (parent?.nullable) continue;
							throw new HttpError.BadRequest(
								`${el.name} requires unique non-null field: ${key}`
							);
						} else {
							cfields.push({ field, val });
							list.push(field);
						}
					}
					if (cfields.length) conditions.push({ types, cfields });
				}
				q.where(q => {
					for (const { cfields, types } of conditions) {
						q.orWhere(q => {
							q.whereIn('block.type', types);
							for (const { field, val } of cfields) {
								const rcol = sql.ref('block.data:' + field);
								if (Array.isArray(val)) {
									q.where(q => {
										for (const str of val) {
											q.orWhere(rcol, '@>', sql.val(str).castJson());
										}
									});
								} else {
									q.whereJsonText('block.data:' + field, val);
								}
							}
						});
					}
				});
				if (list.length > 0) {
					const count = await q.resultSize();
					if (count > 0) {
						throw new HttpError.BadRequest(`${el.name} requires unique fields: ${list.join(', ')}`);
					}
				}
			}
			async $beforeInsert(context) {
				await super.$beforeInsert(context);
				await this.#uniqueProperty(context);
			}
			async $beforeUpdate(opt, context) {
				await super.$beforeUpdate(opt, context);
				await this.#uniqueProperty(context, opt);
			}
			$beforeValidate(jsonSchema, json) {
				if (json.id === null) delete json.id;
				super.$beforeValidate(jsonSchema, json);
				const props = this.$schema(json.type)?.properties ?? {};
				if (props.content?.type == 'null' && json.content) {
					delete json.content;
				}
				if (props.data?.type == 'null' && json.data) {
					delete json.data;
				}
				return jsonSchema;
			}
			async $afterUpdate({ patch, old }, context) {
				await super.$afterUpdate(context);
				await this.#updatePageHref(context);
			}
			async $afterInsert(context) {
				await super.$afterInsert(context);
				await this.#updatePageHref(context);
			}
			async $afterDelete(context) {
				await super.$afterDelete(context);
				const { type, data } = this;
				if (!type || !data) return;
				const { req } = context.transaction;
				if (!req.site.$pkg.groups.page.has(type)) return;
				const { url } = data;
				if (!url) return;
				await req.run('href.del', { url });
			}
			async #updatePageHref(context) {
				const { type, content, data } = this;
				if (!type || !content || !data) return;
				const { req } = context.transaction;
				if (!req.site.$pkg.groups.page.has(type)) return;
				const { url } = data;
				if (!url) return;
				const { title } = content;
				if (title == null) return; // no href without title anyway
				try {
					await req.run('href.save', {
						url,
						title
					});
				} catch {
					// forgiving - lots of href are missing
					await req.run('href.add', { url });
				}
			}
		}

		const site = new DomainBlock();
		Object.assign(site, block);
		return site;
	}

	async $beforeInsert(q) {
		await super.$beforeInsert(q);
		if (!this.id) {
			this.id = Block.genId();
		}
	}
	$schema() {
		return Block.jsonSchema;
	}
}

module.exports = Block;

function cloneRelationMappings(Target, Source) {
	const smaps = Source.relationMappings;
	const tmaps = { ...smaps };
	tmaps.children = {
		...smaps.children,
		modelClass: Target
	};
	tmaps.parents = {
		...smaps.parents,
		modelClass: Target
	};
	return tmaps;
}

function contentsNames(list) {
	return Object.fromEntries(
		(list ?? []).map(def => [
			def.id ?? "",
			{ type: 'string' }
		])
	);
}

function findHrefs(schema, list, root) {
	if (!schema.properties || schema.virtual) return;
	for (const [key, prop] of Object.entries(schema.properties)) {
		if (!prop) {
			console.warn("Missing property:", key, "in schema:", schema.name);
			console.warn('It happens when a property has been set to null');
			continue;
		}
		let path;
		if (root) path = `${root}.${key}`;
		else path = '$.' + key;
		const { $filter } = prop;
		let { $helper } = prop;
		if ($filter?.name == "helper") {
			$helper = $filter.helper;
		}
		const name = $helper?.name ?? $helper;
		if (name && ["href", "pageUrl"].includes(name)) {
			let types = $helper.filter?.type ?? [];
			if (!Array.isArray(types)) types = [types];
			if (types.length == 0) {
				if ($filter?.helper == "pageUrl") types.push('link');
				else console.warn("href helper has no types", $helper, "in", prop);
			}
			if (types.includes('link') && root?.includes('[*]')) {
				// href.change does not know how to update links in arrays
				console.error("nested links in arrays are not supported", root);
			}
			list.push({
				path,
				types
			});
		} else if (prop.type == "array") {
			if (prop.items) {
				path += '[*]';
				findHrefs(prop.items, list, path);
			} else {
				console.error("TODO", path, prop);
			}
		} else {
			findHrefs(prop, list, path);
		}
	}
}

function mergeCSP(csp, commons, el) {
	if (el.csp) for (const [src, list] of Object.entries(el.csp)) {
		const arr = csp[src] ??= [];
		for (const item of (typeof list == "string" ? [list] : list)) {
			const mitem = merge(item, commons.csp);
			if (mitem && !arr.includes(mitem)) arr.push(mitem);
		}
	}
	if (el.scripts) for (const src of el.scripts) {
		const origin = /(^https?:\/\/[.-\w]+)/.exec(src);
		if (origin) {
			const arr = csp.script ??= [];
			if (!arr.includes(origin[0])) arr.push(origin[0]);
		}
	}
	if (el.stylesheets) for (const src of el.stylesheets) {
		const origin = /(^https?:\/\/[.-\w]+)/.exec(src);
		if (origin) {
			const arr = csp.style ??= [];
			if (!arr.includes(origin[0])) arr.push(origin[0]);
		}
	}
}
