const { ref, val, fn, raw } = require.lazy('objection');

module.exports = class TranslateService {
	static name = 'translate';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async init() {
		this.app.languages = await this.app.run('translate.languages');
	}

	lang({ site }, { lang } = {}) {
		if (!site.data.languages?.length) {
			if (lang && lang != site.data.lang) {
				throw new HttpError.BadRequest("Unsupported lang");
			}
			return {
				tsconfig: 'unaccent'
			};
		}
		if (!lang) {
			lang = site.data.languages?.[0];
		} else if (!site.data.languages.includes(lang)) {
			throw new HttpError.BadRequest("Unsupported lang");
		}
		const language = this.app.languages[lang];
		if (!language) throw new HttpError.BadRequest("Unknown language");
		return language;
	}
	static lang = {
		title: 'Get language',
		$lock: true
	};

	async languages({ Block, trx }) {
		const items = await Block.query(trx).columns().where('type', 'language');
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
		const lang = site.data.languages?.[0];
		if (!lang) throw new HttpError.BadRequest("Missing site.data.languages");
		const blocks = await Block.relatedQuery('children', trx).for(site)
			.patch({
				content: raw(`(block_get_content(:id:, :lang)).content`, {
					id: ref('_id'),
					lang
				})
			})
			.whereNot('type', 'content');
		return { blocks };
	}
	static initialize = {
		title: 'Initialize site languages',
		$lock: true,
		$action: 'write'
	};

	async list({ site, trx }, { self, id, lang, limit, offset, valid }) {
		const sourceLang = site.data.languages?.[0];
		if (!sourceLang) throw new HttpError.BadRequest("Missing site.data.languages");

		const q = site.$relatedQuery('children', trx)
			.distinct(
				'target.id', 'target.data', 'target.type', 'target._id',
				ref('source.data:text').castText().as('source')
			);
		if (!self) {
			q.joinRelated('[parents, children as source, children as target]')
				.where('parents.id', id);
		} else {
			q.joinRelated('[children as source, children as target]')
				.where('block.id', id);
		}
		q.whereNot('block.type', 'content')
			.whereIn('block.type', site.$pkg.textblocks)
			.where('source.type', 'content')
			.where(ref('source.data:lang').castText(), sourceLang)
			.where('target.type', 'content')
			.where(ref('target.data:name'), ref('source.data:name'))
			.where(ref('target.data:lang').castText(), lang)
			.whereNot(q => {
				q.where(fn('starts_with', ref('source.data:text').castText(), '<'));
				q.where(fn('regexp_count', ref('source.data:text').castText(), '>\\w'), 0);
			})
			.where(fn.coalesce(ref('target.data:valid').castBool(), false), valid)
			.orderBy('target._id', 'desc');
		const [items, count] = await Promise.all([
			q.limit(limit).offset(offset),
			q.resultSize()
		]);
		return {
			items,
			limit,
			offset,
			count
		};
	}
	static list = {
		title: 'List translations',
		$action: 'read',
		required: ['lang', 'id'],
		properties: {
			lang: {
				title: 'Language',
				type: 'string',
				format: 'lang'
			},
			id: {
				title: 'ID of parent block',
				type: 'string',
				format: 'id'
			},
			self: {
				title: 'Only parent',
				type: 'boolean',
				default: false
			},
			limit: {
				title: 'Limit',
				type: 'integer',
				minimum: 0,
				maximum: 100,
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

	async fill({ site, trx }, data) {
		const lang = site.data.languages?.[0];
		if (!lang) throw new HttpError.BadRequest("Missing site.data.languages");
		const source = this.app.languages[lang];
		if (!source) throw new HttpError.BadRequest("Missing source language: " + lang);
		const target = this.app.languages[data.lang];
		if (!target) throw new HttpError.BadRequest("Missing target language: " + data.lang);

		const q = site.$relatedQuery('children', trx)
			.distinct(
				ref('target._id').as('target_id'),
				ref('source.data:text').castText().as('source')
			);
		if (!data.self) {
			q.joinRelated('[parents, children as source, children as target]')
				.where('parents.id', data.id);
		} else {
			q.joinRelated('[children as source, children as target]')
				.where('block.id', data.id);
		}
		q.whereNot('block.type', 'content')
			.whereIn('block.type', site.$pkg.textblocks)
			.where('source.type', 'content')
			.where(ref('source.data:lang').castText(), lang)
			.where('target.type', 'content')
			.where(ref('target.data:name'), ref('source.data:name'))
			.where(ref('target.data:lang').castText(), data.lang)
			.where(fn.coalesce(ref('target.data:text').castText(), ''), '')
			.orderBy('target._id', 'desc');
		const [items, count] = await Promise.all([
			q.limit(data.limit).offset(data.offset),
			q.resultSize()
		]);

		if (count == 0) return { status: 404, count };

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
		return { count };
	}

	static fill = {
		title: 'Fill translations',
		$action: 'write',
		required: ['lang', 'id'],
		properties: {
			lang: {
				title: 'Language',
				type: 'string',
				format: 'lang'
			},
			id: {
				title: 'ID of parent block',
				type: 'string',
				format: 'id'
			},
			self: {
				title: 'Only parent',
				type: 'boolean',
				default: false
			},
			limit: {
				title: 'Limit',
				type: 'integer',
				minimum: 0,
				maximum: 100,
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
