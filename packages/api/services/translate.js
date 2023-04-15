const { ref } = require('objection');

module.exports = class TranslateService {
	static name = 'translate';

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
		// update all translations data.targets[lang] = data.source
		if (data.method == "copy") {
			const col = `data:targets.${data.lang}`;
			await dict.$relatedQuery('children', trx)
				.where('type', 'translation')
				.whereNull(ref(col))
				.update({type: 'translation', [col]: ref('data:source') });
		}
		return {};
	}
	static all = {
		title: 'Translate all',
		$action: 'write',
		required: ['id', 'lang'],
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
			method: {
				title: 'Method',
				default: 'copy',
				anyOf: [{
					const: 'copy',
					title: 'Copy'
				}, {
					const: 'weglot',
					title: 'Weglot'
				}]
			}
		}
	};
};
