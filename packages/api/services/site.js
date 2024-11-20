const { deepEqual } = require('node:assert/strict');
const { mergeRecursiveObject } = require('../../../src/utils');

module.exports = class SiteService {
	static name = 'site';
	static $global = true;

	constructor(app) {
		this.app = app;
	}

	async elements() {
		return import("../lib/site.mjs");
	}

	apiRoutes(router) {
		router.write("/site/save", 'site.save');
	}

	#QuerySite({ sql: { trx, Block } }, data) {
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

	async search({ sql: { trx, Block } }, data) {
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

	async add({ sql }, data) {
		const site = await this.#QuerySite({ sql }, { id: data.id });
		if (site) throw new HttpError.Conflict("Site id already exists");
		data = {
			...data,
			type: 'site',
			standalone: true,
			content: {}
		};
		const item = await sql.Block.query(sql.trx).insert(data);
		return { item };
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

	async save(req, data) {
		const { site, sql } = req;
		const { data: initial } = site;
		delete data.hash; // avoids failure
		if (data.languages?.length === 0 && !data.lang) {
			data.languages.push(this.app.languages.default);
		}
		const languagesChanged = data.languages !== undefined &&
			(data.languages?.slice() ?? []).sort().join(' ')
			!=
			(initial.languages?.slice() ?? []).sort().join(' ')
			;
		const toMulti = initial.lang && data.languages?.length > 0;
		const toMono = !initial.lang && data.lang;
		const src = initial.languages?.[0] ?? initial.lang;
		const dst = data.languages?.[0] ?? data.lang ?? initial.languages?.[0];

		if (src && src != dst) {
			await req.run('translate.fill', { id: site.id, lang: dst });
		}
		const sameDeps = Object.isEmpty(data.dependencies) ? true : isEqual(initial.dependencies, data.dependencies);
		const sameEnv = data.env == initial.env;

		mergeRecursiveObject(site.data, data);
		let nsite;
		if (sameDeps && sameEnv) {
			nsite = site;
			this.app.domains.release(nsite);
		} else {
			nsite = await req.call('core.install', site);
		}
		await nsite.$query(sql.trx).patchObject({
			type: nsite.type,
			data: nsite.data
		});
		req.site = nsite;
		if (languagesChanged || toMulti || toMono) {
			await req.run('translate.initialize');
		}
		return nsite;
	}
	static save = {
		title: 'Save',
		$action: 'write',
		$ref: "/elements#/definitions/site/properties/data",
		$global: false
	};

	all({ sql: { trx, Block } }, { text }) {
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
		ret.blocks = await site.$relatedQuery('children', req.sql.trx).delete();
		ret.hrefs = await site.$relatedQuery('hrefs', req.sql.trx).delete();
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

	async gc({ site, sql: { trx, raw, ref, fun } }, { age }) {
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

function isEqual(a, b) {
	try {
		deepEqual(a, b);
		return true;
	} catch {
		return false;
	}
}
