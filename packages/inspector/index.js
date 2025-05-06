const Inspector = require.lazy('url-inspector');

module.exports = class InspectorModule {
	static name = 'inspector';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	#create(opts) {
		return new Inspector.default(opts);
	}

	#local;
	get local() {
		if (!this.#local) this.#local = this.#create({
			...this.opts,
			nofavicon: true,
			file: true
		});
		return this.#local;
	}

	#remote;
	get remote() {
		if (!this.#remote) this.#remote = this.#create(this.opts);
		return this.#remote;
	}

	async request(req, urlObj) {
		return Inspector.default.get(urlObj);
	}

	async get(req, { url }) {
		const localFile = req.call('statics.path', url);
		try {
			if (localFile != null) {
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
			throw HttpError.from(err, "Inspector failure");
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
		const desc = obj.meta.description ?? '';
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
		if (desc) {
			obj.meta.alt = desc;
		}
		return obj;
	}

};
