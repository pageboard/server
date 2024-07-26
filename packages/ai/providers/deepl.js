const { Translator } = require('deepl-node');

class AiModule {
	#inst;

	constructor(opts) {
		this.opts = opts;
		this.#inst = new Translator(opts.apiKey, {
			minTimeout: 20 * 1000,
			maxRetries: 0
		});
	}

	async ask(type, { source, target }, strings) {
		const response = await this.#inst.translateText(
			strings.map(str => str.replaceAll(/>&nbsp;/g, '><nbsp/>')),
			source, target, {
				formality: 'prefer_less',
				splitSentences: 'nonewlines',
				tagHandling: 'html',
				preserveFormatting: true,
				context: 'Website'
			}
		);
		return response.map(obj => obj.text.replaceAll(/><nbsp\/>/g, '>&nbsp;'));
	}

}

module.exports = AiModule;
