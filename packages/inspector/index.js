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

	async get({ url, local }) {
		try {
			const meta = await (local ? this.local.look(url) : this.remote.look(url));
			const result = this.#filterResult(meta);
			return this.#preview(result);
		} catch (err) {
			if (typeof err == 'number') throw new HttpError[err]("Inspector failure");
			else throw err;
		}
	}

	#filterResult(result) {
		const obj = {meta:{}};
		['mime', 'url', 'type', 'title', 'icon', 'site']
			.forEach(key => {
				if (result[key] !== undefined) obj[key] = result[key];
			});
		if (obj.icon == "data:/,") delete obj.icon;
		if (result.url) obj.pathname = (new URL(result.url)).pathname;
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
		const thumb = obj.meta.thumbnail;
		delete obj.meta.thumbnail;
		if (thumb != null) {
			try {
				const datauri = await this.app.image.thumbnail(thumb);
				obj.preview = `<img src="${datauri.content}" alt="${desc}" />`;
			} catch (err) {
				console.error("Error embedding thumbnail", thumb, err);
			}
		}
		if (!obj.preview && desc) {
			obj.preview = desc;
		}
		return obj;
	}
};


