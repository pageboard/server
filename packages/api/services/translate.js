module.exports = class TranslateService {
	static name = 'translate';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async schema() {
		return import('../lib/language.mjs');
	}

	async init() {
		const list = await this.app.run('translate.available');
		this.app.languages = Object.fromEntries(
			list.map(item => [item.data.lang, item])
		);
		this.app.languages.default = list[0];
	}

	lang(req, { lang } = {}) {
		const { site } = req;
		if (lang) req.headers['accept-language'] = lang;
		const availables = [];
		if (site.data.languages?.length) availables.push(...site.data.languages);
		else if (site.data.lang) availables.push(site.data.lang);
		const accepted = req.acceptsLanguages(availables) ?? 'default';
		const language = this.app.languages[accepted] ?? this.app.languages.default;
		if (!req.res.headersSent) {
			req.res.set('Content-Language', language.data.lang);
		}
		return language.data;
	}
	static lang = {
		title: 'Get language',
		$lock: true,
		properties: {
			lang: {
				title: 'Language',
				type: 'string',
				format: 'lang',
				nullable: true
			}
		}
	};

	async languages({ site }) {
		const { languages } = this.app;
		return {
			items: site.data.languages?.map(lang => languages[lang]) ?? []
		};
	}
	static languages = {
		title: 'List site languages',
		$action: 'read'
	};

	async available({ Block, trx }, { lang }) {
		// deux usages: savoir quels languages sont disponibles dans pageboard
		// savoir quels languages sont disponibles dans un site donné
		if (!lang) {
			const shared = await Block.query(trx).where('type', 'site').where('id', 'shared').first();
			lang = shared?.data.languages?.[0];
		}
		return Block.query(trx).whereSite('shared')
			.columns({ content: true, lang }).where('block.type', 'language');
	}
	static available = {
		title: 'List available languages',
		$lock: true,
		$global: true,
		properties: {
			lang: {
				title: 'Titles language',
				type: 'string',
				format: 'lang',
				nullable: true
			}
		}
	};

	async initialize({ site, trx, ref, raw, Block }) {
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

	async list({ site, trx, ref, fun }, { self, id, lang, limit, offset, valid }) {
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
				q.where(fun('starts_with', ref('source.data:text').castText(), '<'));
				q.where(fun('regexp_count', ref('source.data:text').castText(), '>\\w'), 0);
			})
			.where(fun.coalesce(ref('target.data:valid').castBool(), false), valid)
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

	async fill({ site, trx, ref, val, fun }, data) {
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
			.where(fun.coalesce(ref('target.data:text'), val('').castJson()), val('').castJson())
			.orderBy('target._id', 'desc');

		const [items, count] = await Promise.all([
			q.limit(data.limit).offset(data.offset),
			q.resultSize()
		]);

		if (count == 0) return { ...data, count };

		const body = new URLSearchParams({
			tag_handling: 'html',
			preserve_formatting: 1,
			source_lang: source.data.translation,
			target_lang: target.data.translation
		});
		for (const row of items) {
			body.append('text', row.source.replaceAll(/>&nbsp;/g, '><nbsp/>'));
		}

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
			const target = obj.translations[i].text.replaceAll(/><nbsp\/>/g, '>&nbsp;');
			await site.$relatedQuery('children', trx)
				.where('block._id', items[i].target_id)
				.patch({
					type: 'content',
					'data:text': val(target).castJson()
				});
		}
		return { ...data, count };
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
