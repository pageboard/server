const { mergeRecursive } = require('../../../src/utils');
const schemas = require.lazy('../lib/schemas');

module.exports = class SiteService {
	static name = 'site';

	constructor(app) {
		this.app = app;
	}

	apiRoutes(app, server) {
		server.put('/.api/site', app.auth.lock('webmaster'), async (req, res) => {
			const data = {
				...req.body,
				id: req.site.id
			};
			const site = await req.run('site.save', data);
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

	async get(req, data) {
		return this.#QuerySite(req, data).throwIfNotFound().select();
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
			.select().where('site.type', 'site')
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
			data: schemas.site
		}
	};

	async save(req, data) {
		const { site } = req;
		const dbSite = await this.get(req, data);
		const dbLanguages = dbSite.data.languages?.slice() ?? [];
		const languages = data.languages ?? [];
		if (languages.join(' ') != dbLanguages.join(' ')) {
			await req.run('translate.initialize');
		}

		mergeRecursive(dbSite.data, data.data);
		if (site && site.url) {
			dbSite.url = site.url;
		}
		const runSite = await this.app.install(dbSite);
		const copy = { ...data.data };
		await runSite.$query(req.trx).patchObject({
			type: runSite.type,
			data: copy
		});
		return runSite;
	}
	static save = {
		title: 'Save site',
		$action: 'write',
		$lock: true,
		required: ['id', 'data'],
		properties: {
			id: {
				title: 'ID',
				type: 'string',
				format: 'id'
			},
			data: schemas.site
		}
	};

	all({ trx, Block }, { text }) {
		const q = Block.query(trx).where('type', 'site').select();
		if (text !== undefined) {
			q.from(Block.raw("websearch_to_tsquery('unaccent', ?) AS query, block", [text]));
			q.whereRaw(`query @@ block.tsv`);
			q.orderByRaw(`ts_rank(block.tsv, query) DESC`);
		}
		return q;
	}
	static all = {
		title: 'List all sites',
		$action: 'write',
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

	async gc({ trx }) {
		// deletes all blocks that belong to no site
		const ret = await trx.raw(`DELETE FROM block
		WHERE block.type NOT IN ('site', 'user') AND NOT EXISTS (SELECT c._id FROM block c, relation r, block p
		WHERE c._id = block._id AND r.child_id = c._id AND p._id = r.parent_id AND p.type IN ('site', 'user')
		GROUP BY c._id HAVING count(*) >= 1)`);
		return ret;
	}
};
