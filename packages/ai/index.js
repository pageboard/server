const { Anthropic } = require.lazy('@anthropic-ai/sdk');
const { OpenAI } = require.lazy('openai');
const { merge } = require('../../src/utils');

module.exports = class AiModule {
	static name = 'ai';

	#ai;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		if (this.opts.name == "anthropic") {
			this.#ai = new Anthropic({ apiKey: this.opts.apiKey });
		} else if (this.opts.name == "openai") {
			this.#ai = new OpenAI.OpenAI({ apiKey: this.opts.apiKey });
		} else {
			console.info("Bad value for option: ai.name");
		}
	}

	async #anthropicRequest(directive, contents) {
		const messages = [{
			role: "user",
			content: [{
				type: "text",
				text: directive
			}, ...contents.map(text => ({
				type: "text",
				text
			}))]
		}, {
			role: "assistant",
			content: "Here is the JSON requested:"
		}];

		const response = await this.#ai.messages.create({
			model: this.opts.model,
			max_tokens: 4096,
			temperature: 0.1, // default 1
			messages
		});
		const { content } = response;
		if (content.length != 1) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
		try {
			return JSON.parse(content[0].text).translations;
		} catch (err) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
	}

	async #openaiRequest(directive, contents) {
		const messages = [{
			role: "system",
			content: directive,
		}, ...contents.map(content => ({
			role: 'user',
			content
		}))];

		const response = await this.#ai.chat.completions.create({
			model: this.opts.model,
			response_format: {
				type: "json_object"
			},
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
			return JSON.parse(content).translations;
		} catch (err) {
			console.error(response);
			throw new HttpError.InternalServerError("Bad AI answer");
		}
	}

	async #makeRequest(directive, contents) {
		if (this.opts.name == "openai") {
			return this.#openaiRequest(directive, contents);
		} else if (this.opts.name == "anthropic") {
			return this.#anthropicRequest(directive, contents);
		}
	}

	async #makeSmallImage(req, url) {
		const uri = await req.call('image.thumbnail', { url, height: 256 });
		if (this.opts.name == "openai") {
			return {
				type: "image_url",
				image_url: {
					detail: "low",
					url: uri
				}
			};
		} else if (this.opts.name == "anthropic") {
			const [header, data] = uri.split(',');
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
		return this.#makeRequest(directive, [
			await this.#makeSmallImage(req, url)
		]);
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
