module.exports = class InspectorModule {
	static name = 'inspector';

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

	async request(urlObj) {
		return this.Inspector.get(urlObj);
	}

	async get({ url }) {
		const localFile = this.app.statics.urlToPath(url);
		const local = Boolean(localFile);
		try {
			if (local) {
				const meta = await this.local.look(`file://${localFile}`);
				const result = this.#filterResult(meta, url);
				const obj = await this.#preview(result);
				return obj;
			} else {
				const meta = await this.remote.look(url);
				const result = this.#filterResult(meta);
				const obj = await this.#preview(result);
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

	async #preview(obj) {
		const desc = obj.meta.description || '';
		delete obj.meta.description;
		const url = obj.meta.thumbnail;
		delete obj.meta.thumbnail;
		if (url != null) {
			try {
				const datauri = await this.app.run('image.thumbnail', { url });
				obj.preview = `<img src="${datauri.content}" alt="${desc}" />`;
			} catch (err) {
				console.error("Error embedding thumbnail", url, err);
			}
		}
		if (!obj.preview && desc) {
			obj.preview = desc;
		}
		return obj;
	}
};


