const { OpenAI } = require.lazy('openai');

module.exports = class InspectorModule {
	static name = 'inspector';

	#openai;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async init() {
		const Inspector = this.Inspector = (await import('url-inspector')).default;
		this.local = new Inspector({
			...this.opts,
			nofavicon: true,
			file: true
		});
		this.remote = new Inspector(this.opts);
	}

	async request(req, urlObj) {
		return this.Inspector.get(req, urlObj);
	}

	async get(req, { url }) {
		const localFile = this.app.statics.urlToPath(req, url);
		const local = Boolean(localFile);
		try {
			if (local) {
				const meta = await this.local.look(`file://${localFile}`);
				const result = this.#filterResult(meta, url);
				const obj = await this.#preview(req, result);
				return obj;
			} else {
				const meta = await this.remote.look(url);
				const result = this.#filterResult(meta);
				const obj = await this.#preview(req, result);
				return obj;
			}
		} catch (err) {
			if (typeof err == 'number') throw new HttpError[err]("Inspector failure");
			else throw err;
		}
	}

	#filterResult(result, localUrl) {
		const obj = { meta: {} };
		['mime', 'url', 'type', 'title', 'icon', 'site']
			.forEach(key => {
				if (result[key] !== undefined) obj[key] = result[key];
			});
		if (obj.icon == "data:/,") delete obj.icon;
		if (localUrl) {
			obj.site = null;
			obj.pathname = obj.url = localUrl;
		} else if (result.url) {
			obj.pathname = (new URL(result.url)).pathname;
		}
		['width', 'height', 'duration', 'size', 'thumbnail', 'description', 'source']
			.forEach(key => {
				if (result[key] !== undefined) obj.meta[key] = result[key];
			});
		if (obj.type == "image" && obj.mime != "text/html") {
			if (!obj.meta.thumbnail) obj.meta.thumbnail = obj.url;
			if (!obj.meta.width || !obj.meta.height) throw new HttpError.BadRequest("Bad image.\nCheck it does not embed huge metadata (thumbnail, icc profile, ...).");
			obj.meta.width = Math.round(obj.meta.width);
			obj.meta.height = Math.round(obj.meta.height);
		}
		return obj;
	}

	async #preview(req, obj) {
		const desc = obj.meta.description;
		delete obj.meta.description;
		const url = obj.meta.thumbnail;
		delete obj.meta.thumbnail;
		if (url != null) {
			try {
				const datauri = await req.run('image.thumbnail', { url });
				obj.preview = `<img src="${datauri}" alt="${desc}" />`;
			} catch (err) {
				console.error("Error embedding thumbnail", url, err);
			}
		}
		if (desc == null && obj.site == null && obj.type == 'image') {
			obj.meta.alt = await req.call('inspector.vision', { url });
		} else if (desc) {
			obj.meta.alt = desc;
		}
		return obj;
	}

	async vision(req, { url }) {
		if (!this.opts.openai) {
			console.info("openai vision disabled");
			return;
		}
		if (!this.#openai) this.#openai = new OpenAI.OpenAI(this.opts.openai);
		const languageTitle = req.call('translate.default').content[""];
		const response = await this.#openai.chat.completions.create({
			model: "gpt-4o",
			messages: [{
				role: "system",
				content: "Give answers in " + languageTitle
			}, {
				role: "user",
				content: [{
					type: "text",
					text: "Describe this image using less than 30 words"
				}, {
					type: "image_url",
					image_url: {
						detail: "low",
						url: await req.call('image.thumbnail', { url, height: 256 })
					}
				}]
			}]
		});
		const choice = response.choices?.[0];
		if (!choice) {
			console.error(response);
			throw new HttpError.InternalServerError("Missing assistant response");
		}
		if (choice.message?.role != "assistant") {
			console.error(choice);
			throw new HttpError.InternalServerError("Bad assistant response");
		}
		return choice.message?.content;
	}
	static vision = {
		title: 'Describe Image',
		properties: {
			url: {
				title: 'Image',
				type: 'string',
				format: 'pathname'
			}
		}
	};

};
