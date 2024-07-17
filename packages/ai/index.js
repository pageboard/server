const Anthropic = require.lazy('@anthropic-ai/sdk');
const OpenAI = require.lazy('openai');
const ChatTokens = require.lazy('openai-chat-tokens');
const { merge } = require('../../src/utils');
const MAX_TOKENS = 4096;

module.exports = class AiModule {
	static name = 'ai';

	#ai;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		if (this.opts.name == "anthropic") {
			this.#ai = new Anthropic({
				apiKey: this.opts.apiKey,
				timeout: 20 * 1000
			});
		} else if (this.opts.name == "openai") {
			this.#ai = new OpenAI({
				apiKey: this.opts.apiKey,
				timeout: 20 * 1000
			});
		} else {
			console.info("Bad value for option: ai.name");
		}
	}

	#anthropicMessages(directive, contents) {
		return [{
			role: "user",
			content: [{
				type: "text",
				text: directive
			}, ...contents.map(text => {
				if (typeof text == "string") {
					return {
						type: "text",
						text
					};
				}	else if (text.uri) {
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
			})]
		}, {
			role: "assistant",
			content: "Here is the JSON requested:"
		}];
	}

	#openaiMessages(directive, contents) {
		return [{
			role: "system",
			content: directive,
		}, ...contents.map(content => {
			if (typeof content == "string") {
				return {
					role: "user",
					content
				};
			} else if (content.uri) {
				return {
					type: "image_url",
					image_url: {
						detail: "low",
						url: content.uri
					}
				};
			}
		})];
	}

	async #anthropicRequest(messages) {
		const response = await this.#ai.messages.create({
			model: this.opts.model,
			max_tokens: MAX_TOKENS,
			temperature: 0.1, // default 1
			messages
		});
		const { content } = response;
		if (content.length != 1) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
		try {
			return JSON.parse(content[0].text).response;
		} catch (err) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
	}



	async #openaiRequest(messages) {
		const response = await this.#ai.chat.completions.create({
			model: this.opts.model,
			response_format: {
				type: "json_object"
			},
			max_tokens: MAX_TOKENS,
			temperature: 0.1, // default 1
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

	async #makeRequest(directive, contents) {
		const messages = this.#openaiMessages(directive, contents);
		const estimate = ChatTokens.promptTokensEstimate({ messages });
		if (estimate > MAX_TOKENS) {
			if (contents.length >= 2) {
				return this.#makeRequest(directive, contents.slice(0, Math.ceil(contents.length / 2)));
			} else {
				throw new HttpError.BadRequest("Too many tokens: " + estimate);
			}
		}
		if (this.opts.name == "openai") {
			return this.#openaiRequest(messages);
		} else if (this.opts.name == "anthropic") {
			return this.#anthropicRequest(this.#anthropicMessages(directive, contents));
		}
	}

	async translate(req, { strings, lang }) {
		const srcLang = req.site.data.languages?.[0];
		if (!srcLang) throw new HttpError.BadRequest("Missing site.data.languages");
		const source = this.app.languages[srcLang];
		const target = this.app.languages[lang];
		if (!source) throw new HttpError.BadRequest("Missing source language: " + srcLang);
		if (!target) throw new HttpError.BadRequest("Missing target language: " + lang);

		const directive = merge(this.opts.directives.translate, {
			source: source.content[''], target: target.content['']
		});

		return this.#makeRequest(directive, strings);

	}
	static translate = {
		title: 'Translate',
		$private: true,
		$action: 'read',
		required: ['strings', 'lang'],
		properties: {
			strings: {
				title: 'Strings',
				type: 'array',
				minItems: 1,
				items: {
					type: 'string'
				}
			},
			lang: {
				$ref: "/elements#/definitions/language/properties/data/properties/lang",
			}
		}
	};

	async describe(req, { url, lang }) {
		const language = req.call('translate.lang', { lang });
		const directive = merge(this.opts.directives.describe, {
			target: language.title
		});
		return this.#makeRequest(directive, [{
			uri: await req.call('image.thumbnail', { url, height: 256 })
		}]);
	}
	static describe = {
		title: 'Describe image',
		properties: {
			url: {
				title: 'Image',
				type: 'string',
				format: 'pathname'
			},
			lang: {
				title: 'Lang',
				type: 'string',
				format: 'lang',
				nullable: true
			}
		}
	};

};
