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
		server.put('/.api/site', app.cache.tag('data-:site'), app.auth.lock('webmaster'), async (req, res) => {
			const site = await req.run('site.update', req.body);
			res.send(site);
		});
	}

	#QuerySite({ trx, Block }, data) {
		return Block.query(trx).alias('site').first()
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
		title: 'Find Site',
		$action: 'read',
		$global: false
	};

	async get(req, data) {
		return this.#QuerySite(req, data).throwIfNotFound().columns();
	}
	static get = {
		title: 'Get site',
		$action: 'read',
		$lock: true,
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
		title: 'Search user sites',
		$action: 'read',
		$lock: true,
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
				standalone: true
			};
			return Block.query(trx).insert(data);
		}
	}
	static add = {
		title: 'Add site',
		$action: 'write',
		$lock: true,
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
		title: 'Save site',
		$action: 'write',
		$lock: true, // or lock: site-manager ?
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
		title: 'Update site',
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
		title: 'List all sites',
		$action: 'read',
		$lock: true,
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
		title: 'Delete a site',
		$action: 'write',
		$lock: true,
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
		const site = await this.#QuerySite(req, data);
		const ret = {};
		ret.blocks = await site.$relatedQuery('children', req.trx).delete();
		ret.hrefs = await site.$relatedQuery('hrefs', req.trx).delete();
		return ret;
	}
	static empty = {
		title: 'Empty site',
		$action: 'write',
		$lock: true,
		required: ['id'],
		properties: {
			id: {
				title: 'ID',
				type: 'string',
				format: 'id'
			}
		}
	};

	async gc({ trx, raw }) {
		// deletes all blocks that belong to no site
		const ret = await raw(`DELETE FROM block
		WHERE block.type NOT IN ('site', 'user') AND NOT EXISTS (SELECT c._id FROM block c, relation r, block p
		WHERE c._id = block._id AND r.child_id = c._id AND p._id = r.parent_id AND p.type IN ('site', 'user')
		GROUP BY c._id HAVING count(*) >= 1)`);
		return ret;
	}
};
