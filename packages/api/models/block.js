const common = require('./common');
const { Model } = common;
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
					format: 'name',
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
	};

	static jsonSchema = {
		type: 'object',
		$id: '/blocks',
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
				nullable: true
			},
			expr: {
				title: 'expr',
				type: 'object',
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
			standalone, properties, required = [], contents, name
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
			required
		} : {
			type: 'null'
		};
		const contentSchema = contents ? {
			type: 'object',
			properties: contentsNames(contents),
			additionalProperties: contents.length == 0 ? true : false
		} : {
			type: 'null'
		};

		if (el.bundle === true) for (const p of ElementKeywords) {
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
			if (!contents.nodes) {
				// support old version
				contents = Object.keys(contents).map(key => {
					let val = contents[key];
					if (typeof val == "string") {
						val = {nodes: val};
					} else {
						val = { ...val };
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
		const schema = {
			$id: `/${block.id}/${block.data.version ?? tag}${Block.jsonSchema.$id}`,
			definitions: types,
			type: 'object',
			discriminator: { propertyName: "type" },
			required: ['type'],
			oneOf: []
		};
		const hrefs = {};
		// TODO merge csp for each page bundle

		for (const [type, element] of Object.entries(eltsMap)) {
			const hrefsList = [];
			findHrefs(element, hrefsList);
			if (hrefsList.length) hrefs[type] = hrefsList;
			types[type] = Block.elementToSchema(element);
			schema.oneOf.push({ $ref: `#/definitions/${type}` });
		}

		class DomainBlock extends Block {
			static relationMappings = cloneRelationMappings(this, Block);
			static uniqueTag() {
				return this.jsonSchema.$id;
			}
			static jsonSchema = schema;

			static #types = types;
			static schema(path) {
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

			static #hrefs = hrefs;
			get $hrefs() {
				return DomainBlock.#hrefs;
			}

			#pkg = {
				bundles: new Map(),
				standalones: Array.from(standalones),
				pages: groups.page ?? [],
				textblocks: Array.from(textblocks),
				hashtargets: Array.from(hashtargets),
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
			async $beforeInsert(q) {
				await super.$beforeInsert(q);
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
				const url = this.data?.url ?? old?.data?.url;
				if (!url || url.startsWith('/.') || !this.content) return;
				const { req } = context.transaction;
				const { title } = this.content;
				try {
					await req.run('href.save', {
						url,
						title
					});
				} catch (ex) {
					// forgiving - lots of href are missing
					await req.run('href.add', { url });
				}
			}
			async $afterInsert(context) {
				await super.$afterInsert(context);
				const { url } = this.data ?? {};
				if (!url || url.startsWith('/.') || !this.content) return;
				const { title } = this.content;
				if (title == null) return;
				const { req } = context.transaction;
				await req.run('href.add', { url });
			}
			async $afterDelete(context) {
				await super.$afterDelete(context);
				const { url } = this.data ?? {};
				if (!url || url.startsWith('/.')) return;
				const { req } = context.transaction;
				await req.run('href.del', { url });
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
		if ($helper == "href" || $helper?.name == "href") {
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
