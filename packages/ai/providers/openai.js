const OpenAI = require('openai');
const { merge } = require('../../../src/utils');

class AiModule {
	#inst;

	constructor(opts) {
		this.opts = opts;
		this.#inst = new OpenAI({
			apiKey: opts.apiKey,
			timeout: 20 * 1000
		});
	}

	async ask(type, params, strings) {
		const directive = merge(this.opts[type], params);
		const messages = this.#messages(directive, strings);

		const response = await this.#inst.chat.completions.create({
			model: this.opts.model,
			response_format: {
				type: "json_object"
			},
			max_tokens: this.opts.maxTokens,
			temperature: 0, // default 1
			messages
		});
		const { choices } = response;
		if (choices.length != 1) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
		const { content } = choices[0].message ?? {};
		try {
			return JSON.parse(content).response;
		} catch (err) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
	}

	#messages(directive, contents) {
		return [{
			role: "system",
			content: directive,
		}, ...contents.map(content => {
			if (typeof content == "string") {
				return {
					role: "user",
					type: "text",
					content
				};
			} else if (content.uri) {
				return {
					role: "user",
					content: [{
						type: "image_url",
						image_url: {
							detail: "low",
							url: content.uri
						}
					}]
				};
			} else {
				throw new HttpError.BadRequest("Unknown content type");
			}
		})];
	}

}

module.exports = AiModule;
