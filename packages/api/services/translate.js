const { ref, val } = require('objection');

module.exports = class TranslateService {
	static name = 'translate';

	constructor(app, opts) {
		this.opts = opts;
	}

	async all({ site, trx }, data) {
		const dict = await site.$relatedQuery('children', trx)
			.select().first()
			.where('block.type', 'dictionary')
			.where('block.id', data.id);
		if (!dict) {
			throw new HttpError.NotFound("dictionary not found");
		}
		if (!dict.data.targets?.includes(data.lang)) {
			throw new HttpError.BadRequest("lang in dictionary targets");
		}
		const col = `data:targets.${data.lang}.text`;
		if (data.operation == "clear") {
			await dict.$relatedQuery('children', trx)
				.where('type', 'translation')
				.patch({
					type: 'translation',
					[col]: val(null).castJson()
				});
		} else if (data.operation == "copy") {
			await dict.$relatedQuery('children', trx)
				.where('type', 'translation')
				.whereNull(ref(col))
				.patch({
					type: 'translation',
					[col]: ref('data:source')
				});
		} else if (data.operation == "auto") {
			const sources = await dict.$relatedQuery('children', trx)
				.select('block.id', ref('block.data:source').as('source'))
				.where('block.type', 'translation').limit(100);
			const words = sources.map(row => { return { w: row.source, t: 1 }; });

			const res = await fetch(this.opts.url, {
				method: 'post',
				body: JSON.stringify({
					l_from: dict.data.source,
					l_to: data.lang,
					request_url: "https://myse.museum",
					words
				}),
				headers: {
					'Content-Type': 'application/json'
				}
			});
			if (res.status != 200) {
				throw new HttpError[res.status](res.statusText);
			}
			const obj = await res.json();
			for (let i = 0; i < obj.from_words.length; i++) {
				const source = obj.from_words[i];
				if (source != sources[i].source) {
					console.error("Source mismatch", i);
				}
				const target = obj.to_words[i];
				await dict.$relatedQuery('children', trx)
					.where('block.type', 'translation')
					.where('block.id', sources[i].id)
					.patch({
						type: 'translation',
						[col]: val(target).castJson()
					});
			}
		}
		return {};
	}
	static all = {
		title: 'Translate dictionary',
		$action: 'write',
		required: ['id', 'lang', 'operation'],
		properties: {
			id: {
				title: 'Dictionary ID',
				type: 'string',
				format: 'id'
			},
			lang: {
				title: 'Language',
				type: 'string',
				format: 'name'
			},
			operation: {
				title: 'Operation',
				default: 'copy',
				anyOf: [{
					const: 'clear',
					title: 'Clear'
				}, {
					const: 'copy',
					title: 'Copy'
				}, {
					const: 'auto',
					title: 'Auto'
				}]
			}
		}
	};
};
