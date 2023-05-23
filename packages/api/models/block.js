const common = require('./common');
const { Model } = common;
const crypto = require('node:crypto');

class Block extends Model {
	static useLimitInFirst = true;

	static tableName = 'block';

	static idColumn = '_id';

	static jsonSchema = {
		type: 'object',
		required: ['type'],
		$id: '/api/blocks',
		properties: {
			id: {
				title: 'ID',
				type: 'string',
				format: 'id'
			},
			type: {
				title: 'Type',
				type: 'string',
				format: 'name'
			},
			data: {
				title: 'Datas',
				type: 'object'
			},
			expr: {
				title: 'Expressions',
				type: 'object',
				nullable: true
			},
			content: {
				title: 'Contents',
				type: 'object',
				additionalProperties: { type: 'string' }
			},
			standalone: { // a standalone block can have 0 or multiple parents
				title: 'Standalone',
				type: 'boolean',
				default: false
			},
			updated_at: {
				title: 'Last Update',
				format: 'date-time',
				type: 'string'
			},
			lock: {
				title: 'Locks',
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

	async $beforeInsert(q) {
		await super.$beforeInsert(q);
		if (!this.id) {
			this.id = await Block.genId();
		}
	}

	static async setLanguageContent(trx, row, lang, newContent) {
		if (lang == null && !newContent) return row;
		const rawContent = newContent ?
			trx.raw('block_set_content(block._id, :content::jsonb, :lang)', {
				lang,
				content: row.content
			})
			:
			trx.raw('block_set_content(block._id, block.content, :lang)', {
				lang
			});
		const { updated_at } = await Block.query(trx)
			.where('_id', row._id)
			.first()
			.patch({
				type: row.type,
				content: rawContent
			}).returning('updated_at');
		row.updated_at = updated_at;
		return row;
	}

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
		const { eltsMap, groups, tag, standalones, textblocks } = pkg;
		if (!block.id) {
			throw new Error("missing block.id\n" + JSON.stringify(block));
		}
		const schema = {
			$id: `${Block.jsonSchema.$id}/${block.id}`,
			type: 'object',
			discriminator: { propertyName: "type" },
			required: ['type'],
			oneOf: []
		};
		const blockProps = Block.jsonSchema.properties;

		const hrefs = {};
		const ElementKeywords = [
			'$lock', 'parents', 'upgrade', 'csp', 'mime', 'templates'
		];
		const types = new Map();

		for (const [type, element] of Object.entries(eltsMap)) {
			const hrefsList = [];
			findHrefs(element, hrefsList);
			if (hrefsList.length) hrefs[type] = hrefsList;

			const { standalone, properties, required = [], contents } = element;

			const sub = {
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
			if (element.output) {
				// temporary compatibility, remove soon
				element.mime = element.output.mime;
				delete element.output;
			}

			for (const p of ElementKeywords) {
				if (element[p] != null) sub[p] = element[p];
			}
			Object.assign(sub.properties, blockProps, standProp, {
				type: { const: type },
				data: dataSchema,
				content: contentSchema
			});
			types.set(type, sub);
			schema.oneOf.push(sub);
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
				let sch = this.#types.get(type);
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
				bundles: {},
				standalones: Array.from(standalones),
				pages: groups.page ?? [],
				textblocks,
				tag
			};

			get $pkg() {
				return this.#pkg;
			}
			$clone(opts) {
				const copy = super.$clone(opts);
				Object.assign(copy.$pkg, this.$pkg);
				return copy;
			}
			$beforeValidate(jsonSchema, json) {
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
				if (!url || url.startsWith('/.')) return;
				const title = this.data?.title ?? this.content?.title;
				const { req } = context.transaction;
				if (title == null) try {
					await req.run('href.del', { url });
				} catch (ex) {
					// miss
				} else try {
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
				if (!url || url.startsWith('/.')) return;
				const title = this.data?.title ?? this.content?.title;
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
		if (!prop) throw new Error("Missing prop:" + key);
		let path;
		if (array) path = root;
		else if (root) path = `${root}.${key}`;
		else path = key;
		const { $helper, $filter } = prop;
		if ($helper == "href" || $helper?.name == "href") {
			let types = $helper.filter?.type ?? [];
			if (!Array.isArray(types)) types = [types];
			if (types.length == 0) {
				if ($filter?.helper == "pageUrl") types.push('link');
				else console.warn("href helper has no types", $helper);
			}
			list.push({ path, types, array });
		} else if (prop.type == "array") {
			findHrefs({properties: {items: prop.items}}, list, path, true);
		} else {
			findHrefs(prop, list, path);
		}
	}
}
