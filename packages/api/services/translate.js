const { ref, val, raw } = require('objection');

module.exports = class TranslateService {
	static name = 'translate';

	constructor(app, opts) {
		this.opts = opts;
	}

	async initialize({ site, trx }) {
		const lang = site.data.languages?.[0];
		if (!lang) throw new HttpError.BadRequest("Missing site.data.languages");
		await site.$relatedQuery('children', trx)
			.whereNot('block.type', 'content')
			.select(raw(
				`block_set_content(
					block._id, block_get_content(block._id, :lang), :lang
				)`, { lang }
			));
	}
	static initialize = {
		title: 'Initialize site languages',
		$lock: true,
		$action: 'write'
	};

	async fill({ site, trx, Block }, data) {
		const lang = site.data.languages?.[0];
		if (!lang) throw new HttpError.BadRequest("Missing site.data.languages");
		const languages = await Block.query(trx).select()
			.where('type', 'language')
			.whereIn('data:lang', site.data.language);
		const source = languages.find(item => item.data.lang == lang);
		if (!source) throw new HttpError.BadRequest("Missing source language: " + lang);
		const target = languages.find(item => item.data.lang == data.lang);
		if (!target) throw new HttpError.BadRequest("Missing target language: " + data.lang);

		const rows = await site.$relatedQuery('children', trx)
			.select(
				'source.data:text AS text',
				'target._id AS target_id'
			)
			.joinRelated('[parents, children as source, children as target]')
			.where('parents.id', data.parent)
			.where('source.type', 'content')
			.where('source.data:lang', lang)
			.where('target.type', 'content')
			.whereNull('target.data:text')
			.limit(10);

		const body = new URLSearchParams({
			tag_handling: 'html',
			preserve_formatting: 1,
			source_lang: source.data.translation,
			target_lang: target.data.translation
		});
		for (const row of rows) body.append('text', row.text);

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
				.where('block._id', rows[i].target_id)
				.patch({
					type: 'content',
					'data:text': val(target).castJson()
				});
		}
	}

	static fill = {
		title: 'Fill',
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
			}
		}
	};
};
