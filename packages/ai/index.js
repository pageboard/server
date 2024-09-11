module.exports = class AiModule {
	static name = 'ai';

	#translator;
	#depictor;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	#getTranslator() {
		if (!this.#translator) {
			this.#translator = new (require('./providers/' + this.opts.translator))(this.opts[this.opts.translator]);
		}
		return this.#translator;
	}

	#getDepictor() {
		if (!this.#depictor) {
			this.#depictor = new (require('./providers/' + this.opts.depictor))(this.opts[this.opts.depictor]);
		}
		return this.#depictor;
	}

	apiRoutes(app) {
		app.get("/@api/ai/depict", 'ai.depict');
	}

	async translate(req, { strings, lang }) {
		const srcLang = req.site.data.languages?.[0];
		if (!srcLang) throw new HttpError.BadRequest("Missing site.data.languages");
		const source = this.app.languages[srcLang];
		const target = this.app.languages[lang];
		if (!source) throw new HttpError.BadRequest("Missing source language: " + srcLang);
		if (!target) throw new HttpError.BadRequest("Missing target language: " + lang);

		const list = await this.#getTranslator().ask('translate', {
			source: source.data.translation.split('-').shift(),
			target: target.data.translation
		}, strings);

		return {
			items: list.map(text => ({
				type: 'content',
				data: { text }
			}))
		};
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

	async depict(req, { url, lang }) {
		const language = req.call('translate.lang', { lang });
		const text = await this.#getDepictor().ask('depict', { target: language.title }, [{
			uri: await req.call('image.thumbnail', { url, height: 512 })
		}]);
		return {
			item: {
				type: 'content',
				data: { text }
			}
		};
	}
	static depict = {
		title: 'Depict image',
		$action: 'read',
		$private: true,
		$lock: 'webmaster',
		required: ['url'],
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
