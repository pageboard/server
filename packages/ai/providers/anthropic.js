const Anthropic = require('@anthropic-ai/sdk');
const { merge } = require('../../../src/utils');

class AiModule {
	#inst;

	constructor(opts) {
		this.opts = opts;
		this.#inst = new Anthropic({
			apiKey: opts.apiKey,
			timeout: 20 * 1000
		});
	}

	async ask(type, params, strings) {
		const directive = merge(this.opts[type], params);
		const messages = this.#messages(directive, strings);
		const response = await this.#inst.messages.create({
			model: this.opts.model,
			max_tokens: this.opts.maxTokens,
			temperature: 0, // default 1
			messages
		});
		const { content } = response;
		if (content.length != 1) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
		try {
			return JSON.parse('{' + content[0].text).response;
		} catch (err) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
	}

	#messages(directive, contents) {
		const list = [{
			type: "text",
			text: directive
		}];
		const messages = [{
			role: "user",
			content: list
		}];
		if (contents.every(item => typeof item == "string")) {
			list.push({
				type: 'text',
				text: JSON.stringify(contents)
			});
		} else {
			list.push(...contents.map(text => {
				if (typeof text == "string") {
					return {
						type: "text",
						text
					};
				} else if (text.uri) {
					const [header, data] = text.uri.split(',');
					const [media_type] = header.substring('data:'.length).split(';');
					return {
						type: "image",
						source: {
							type: "base64",
							media_type,
							data
						}
					};
				}
			}));
		}
		messages.push({
			role: "assistant",
			content: "{"
		});
		return messages;
	}

}

module.exports = AiModule;
