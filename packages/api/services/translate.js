const { ref, val, raw, fn } = require.lazy('objection');

module.exports = class TranslateService {
	static name = 'translate';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async apiRoutes(app) {
		app.languages = await app.run('translate.languages');
	}

	async languages({ Block, trx }) {
		const items = await Block.query(trx).select().where('type', 'language');
		const obj = {};
		for (const item of items) {
			obj[item.data.lang] = item.data;
		}
		return obj;
	}
	static languages = {
		title: 'Initialize languages',
		$lock: true
	};

	async initialize({ site, trx, Block }) {
		const blocks = await Block.relatedQuery('children', trx).for(site)
			.patch({
				content: ref('content')
			})
			.whereNot('type', 'content');
		return { blocks };
	}
	static initialize = {
		title: 'Initialize site languages',
		$lock: true,
		$action: 'write'
	};

	async list({ site, trx }, data) {
		const lang = site.data.languages?.[0];
		if (!lang) throw new HttpError.BadRequest("Missing site.data.languages");

		const items = await site.$relatedQuery('children', trx)
			.distinct(
				'target.id', 'target.data', 'target.type', 'target._id',
				ref('source.data:text').castText().as('source')
			)
			.joinRelated('[parents, children as source, children as target]')
			.where('parents.id', data.parent)
			.where('source.type', 'content')
			.where(ref('source.data:lang').castText(), lang)
			.where('target.type', 'content')
			.where(ref('target.data:name'), ref('source.data:name'))
			.where(ref('target.data:lang').castText(), data.lang)
			.where(q => {
				if (data.valid) {
					q.whereNot(fn.coalesce(ref('target.data:text').castText(), ''), '');
					q.orWhere('source.updated_at', '<', ref('target.updated_at'));
				} else {
					q.where(fn.coalesce(ref('target.data:text').castText(), ''), '');
					q.orWhere('source.updated_at', '>=', ref('target.updated_at'));
				}
			})
			.limit(data.limit)
			.offset(data.offset)
			.orderBy('target._id');
		return { items };
	}
	static list = {
		title: 'List translations',
		$action: 'read',
		required: ['lang', 'parent'],
		properties: {
			lang: {
				title: 'Language',
				type: 'string',
				format: 'lang'
			},
			parent: {
				title: 'Parent',
				type: 'string',
				format: 'id'
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
			valid: {
				title: 'Valid',
				description: 'List valid translations',
				type: 'boolean',
				default: false
			}
		}
	};

	async fill({ site, trx, Block }, data) {
		const lang = site.data.languages?.[0];
		if (!lang) throw new HttpError.BadRequest("Missing site.data.languages");
		const source = this.app.languages[lang];
		if (!source) throw new HttpError.BadRequest("Missing source language: " + lang);
		const target = this.app.languages[data.lang];
		if (!target) throw new HttpError.BadRequest("Missing target language: " + data.lang);

		const items = await site.$relatedQuery('children', trx)
			.distinct(
				ref('target._id').as('target_id'),
				ref('source.data:text').castText().as('source')
			)
			.joinRelated('[parents, children as source, children as target]')
			.where('parents.id', data.parent)
			.where('source.type', 'content')
			.where(ref('source.data:lang').castText(), lang)
			.where('target.type', 'content')
			.where(ref('target.data:name'), ref('source.data:name'))
			.where(ref('target.data:lang').castText(), data.lang)
			.where(fn.coalesce(ref('target.data:text').castText(), ''), '')
			.limit(data.limit)
			.offset(data.offset)
			.orderBy('target._id');

		const body = new URLSearchParams({
			tag_handling: 'html',
			preserve_formatting: 1,
			source_lang: source.translation,
			target_lang: target.translation
		});
		for (const row of items) body.append('text', row.source);

		const res = await fetch(this.opts.url, {
			method: 'post',
			headers: {
				Authorization: this.opts.key,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body
		});
		if (res.status != 200) {
			throw new HttpError[res.status](res.statusText);
		}
		const obj = await res.json();
		for (let i = 0; i < obj.translations.length; i++) {
			const target = obj.translations[i].text;
			await site.$relatedQuery('children', trx)
				.where('block._id', items[i].target_id)
				.patch({
					type: 'content',
					'data:text': val(target).castJson()
				});
		}
		return { count: items.length };
	}

	static fill = {
		title: 'Fill translations',
		$action: 'write',
		required: ['lang', 'parent'],
		properties: {
			lang: {
				title: 'Language',
				type: 'string',
				format: 'lang'
			},
			parent: {
				title: 'Parent',
				type: 'string',
				format: 'id'
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
			}
		}
	};
};
