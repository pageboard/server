const { mergeRecursive } = require('../../../src/utils');

module.exports = class SiteService {
	static name = 'site';
	static $global = true;

	constructor(app) {
		this.app = app;
	}

	async elements() {
		return import("../lib/site.mjs");
	}

	apiRoutes(app, server) {
		app.post("/@api/site", 'site.update');
	}

	#QuerySite({ trx, Block }, data) {
		return Block.query(trx).alias('site').first()
			.columns()
			.where('site.type', 'site')
			.where(q => {
				if (data.id) {
					q.orWhere('site.id', data.id);
				}
				if (data.domain) {
					q.orWhereJsonHasAny('site.data:domains', data.domain);
				}
			});
	}

	async find(req) {
		const item = await this.#QuerySite(req, { id: req.site.id })
			.throwIfNotFound().columns();
		return { item };
	}
	static find = {
		title: 'Find',
		$action: 'read',
		$global: false
	};

	async get(req, data) {
		return this.#QuerySite(req, data).throwIfNotFound().columns();
	}
	static get = {
		title: 'Get',
		$action: 'read',
		$private: true,
		properties: {
			id: {
				title: 'ID',
				type: 'string',
				format: 'id'
			},
			domain: {
				title: 'Domain',
				type: 'string',
				format: 'hostname'
			}
		},
		anyOf: [{
			required: ['id']
		}, {
			required: ['domain']
		}]
	};

	async search({ trx, Block }, data) {
		const q = Block.query(trx).alias('site')
			.columns().where('site.type', 'site')
			.joinRelated('children', { alias: 'settings' })
			.where('settings.type', 'settings');
		if (data.grants) q.where(builder => {
			data.grants.forEach(grant => {
				builder.orWhereJsonSupersetOf('settings.data:grants', [grant]);
			});
		});
		return q.joinRelated('parents', { alias: 'user' })
			.where('user.type', 'user')
			.whereJsonText('user.data:email', data.email)
			.orderBy('site.updated_at', 'site.desc')
			.offset(data.offset)
			.limit(data.limit).then(rows => {
				const obj = {
					data: rows,
					offset: data.offset,
					limit: data.limit
				};
				obj.schemas = { // what was my idea here ? Block doesn't have a "site" schema yet since site is defined "by domain"
					//site: Block.schema('site')
				};
				return obj;
			});
	}
	static search = {
		title: 'Search',
		$action: 'read',
		$private: true,
		required: ['email'],
		properties: {
			email: {
				title: 'Email',
				type: 'string',
				format: 'email'
			},
			grants: {
				title: 'Grants',
				type: 'array',
				items: {
					type: 'string',
					format: 'grant'
				}
			},
			limit: {
				title: 'Limit',
				type: 'integer',
				minimum: 0,
				maximum: 50,
				default: 10
			},
			offset: {
				title: 'Offset',
				type: 'integer',
				minimum: 0,
				default: 0
			}
		}
	};

	async add({ trx, Block }, data) {
		const site = await this.#QuerySite({ trx, Block }, { id: data.id });
		if (site) {
			throw new HttpError.Conflict("Site id already exists");
		} else {
			data = {
				...data,
				type: 'site',
				standalone: true,
				content: {}
			};
			return Block.query(trx).insert(data);
		}
	}
	static add = {
		title: 'Add',
		$action: 'write',
		$private: true,
		required: ['id'],
		properties: {
			id: {
				title: 'ID',
				type: 'string',
				format: 'id'
			},
			data: {
				$ref: "/elements#/definitions/site/properties/data"
			}
		}
	};

	async save(req, { id, data }) {
		const oldSite = await this.get(req, { id });
		req.site = oldSite;
		return this.update(req, data);
	}
	static save = {
		title: 'Save',
		$action: 'write',
		$private: true, // or lock: site-manager ?
		required: ['id', 'data'],
		properties: {
			id: {
				title: 'Site ID',
				type: 'string',
				format: 'id'
			},
			data: {
				$ref: "/elements#/definitions/site/properties/data"
			}
		}
	};

	async update(req, data) {
		const oldSite = req.site;
		const { data: initial } = oldSite;
		if (data.languages?.length === 0 && !data.lang) {
			data.languages.push(this.app.languages.default);
		}
		const languagesChanged = data.languages !== undefined &&
			(data.languages ?? []).join(' ')
			!=
			(initial.languages?.slice() ?? []).join(' ')
			;
		const toMulti = initial.lang && data.languages?.length > 0;
		const toMono = !initial.lang && data.lang;
		if (data.version == "HEAD") data.version = null;

		mergeRecursive(oldSite.data, data);

		const site = await this.app.install(oldSite);
		await oldSite.$query(req.trx).patchObject({
			type: site.type,
			data: site.data
		});
		req.site = site;
		if (languagesChanged || toMulti || toMono) {
			await req.run('translate.initialize');
		}
		return site;
	}
	static update = {
		title: 'Update',
		$action: 'write',
		$ref: "/elements#/definitions/site/properties/data",
		$global: false
	};

	all({ trx, Block }, { text }) {
		const q = Block.query(trx).where('type', 'site').columns();
		if (text !== undefined) {
			q.from(Block.raw("websearch_to_tsquery('unaccent', ?) AS query, block", [text]));
			q.whereRaw(`query @@ block.tsv`);
			q.orderByRaw(`ts_rank(block.tsv, query) DESC`);
		}
		return q;
	}
	static all = {
		title: 'List all',
		$action: 'read',
		$private: true,
		properties: {
			text: {
				title: 'Search text',
				type: 'string'
			}
		}
	};

	async del(req, data) {
		const ret = await this.empty(req, data);
		await this.#QuerySite(req, data).delete();
		ret.site = 1;
		return ret;
	}
	static del = {
		title: 'Delete',
		$action: 'write',
		$private: true,
		required: ['id'],
		properties: {
			id: {
				title: 'ID',
				type: 'string',
				format: 'id'
			}
		}
	};

	async empty(req, data) {
		const site = await this.#QuerySite(req, data).throwIfNotFound();
		const ret = {};
		ret.blocks = await site.$relatedQuery('children', req.trx).delete();
		ret.hrefs = await site.$relatedQuery('hrefs', req.trx).delete();
		return ret;
	}
	static empty = {
		title: 'Empty',
		$action: 'write',
		$private: true,
		required: ['id'],
		properties: {
			id: {
				title: 'ID',
				type: 'string',
				format: 'id'
			}
		}
	};

	async gc({ trx, raw, site, ref, fun }, { age }) {
		const { count } = await site.$query(trx).select(
			fun('block_delete_orphans', ref('block._id'), age)
				.as('count')
		);
		return { count };
	}
	static gc = {
		title: 'Garbage collect blocks',
		$private: true,
		$global: false,
		$action: 'write',
		properties: {
			age: {
				title: 'Age',
				description: 'Number of days since last update',
				type: 'integer',
				minimum: 0,
				default: 0
			}
		}
	};
};
