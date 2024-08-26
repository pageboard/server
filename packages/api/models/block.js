const common = require('./common');
const { Model } = common;
const { dget } = require('../../../src/utils');
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
			'$lock', 'parents', 'upgrade', 'csp', 'templates'
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

	static genId(length) {
		// similar function defined in pageboard-write#store.js
		if (!length) length = 8;
		return new Promise((resolve, reject) => {
			crypto.randomBytes(length, (err, buffer) => {
				if (err) reject(err);
				else resolve(buffer.toString('hex'));
			});
		});
	}

	static genIdSync(length) {
		if (!length) length = 8;
		return crypto.randomBytes(length).toString('hex');
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

	static initSite(block, pkg) {
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
		// TODO merge csp for each page bundle

		// rootSchema has already been merged into eltsMap
		for (const [type, element] of Object.entries(eltsMap)) {
			const hrefsList = [];
			findHrefs(element, hrefsList);
			if (hrefsList.length) hrefs[type] = hrefsList;
			types[type] = Block.elementToSchema(element);
			elements.oneOf.push({ $ref: `#/definitions/${type}` });
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
				pages: groups.page ?? new Set(),
				textblocks: Array.from(textblocks),
				hashtargets: Array.from(hashtargets),
				hrefs,
				tag,
				dir: pkg.dir
			};

			get $pkg() {
				return this.#pkg;
			}
			$clone(opts) {
				const copy = super.$clone(opts);
				Object.assign(copy.$pkg, this.$pkg);
				return copy;
			}
			async #uniqueProperty(context, opt = {}) {
				const el = this.$schema();
				const { unique } = el?.properties?.data ?? {};
				if (!unique || !this.type) return;
				const { req: { trx, site } } = context.transaction;
				const q = site.$relatedQuery('children', trx)
					.where('block.type', this.type);
				const id = opt.old?.id ?? this.id;
				if (id != null) q.whereNot('block.id', id);
				let hasCheck = false;
				for (const field of unique) {
					const key = `data.${field}`;
					const val = dget(opt.old || this, key);
					if (val == null) {
						if (val === undefined && opt.patch) continue;
						const parent = dget(el.properties, key.split('.').join('.properties.'));
						if (parent?.nullable) continue;
						throw new HttpError.BadRequest(
							`Element ${el.name} requires unique ${key} but value is null`
						);
					}
					hasCheck = true;
					q.whereJsonText('data:' + field, val);
				}
				if (!hasCheck) return;
				const count = await q.resultSize();
				if (count > 0) {
					throw new HttpError.BadRequest(`Element requires unique fields ${unique} but there are already ${count} rows`);
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
				if (!req.site.$pkg.pages.has(type)) return;
				const { url } = data;
				if (!url) return;
				await req.run('href.del', { url });
			}
			async #updatePageHref(context) {
				const { type, content, data } = this;
				if (!type || !content || !data) return;
				const { req } = context.transaction;
				if (!req.site.$pkg.pages.has(type)) return;
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
			this.id = await Block.genId();
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

function findHrefs(schema, list, root, array) {
	if (!schema.properties || schema.virtual) return;
	for (const [key, prop] of Object.entries(schema.properties)) {
		if (!prop) {
			console.warn("Missing property:", key, "in schema:", schema.name);
			console.warn('It happens when a property has been set to null');
			continue;
		}
		let path;
		if (array) path = root;
		else if (root) path = `${root}.${key}`;
		else path = key;
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
			list.push({ path, types, array });
		} else if (prop.type == "array") {
			findHrefs({properties: {items: prop.items}}, list, path, true);
		} else {
			findHrefs(prop, list, path);
		}
	}
}
