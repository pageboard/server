export class BearerAgent {

	constructor(opts, baseUrl) {
		this.baseUrl = baseUrl;
		this.opts = opts;
	}

	async fetch(path, method = "get", query = {}) {
		const opts = {};
		if (!Object.isEmpty(query)) {
			const fd = new FormData();
			for (const [key, val] of Object.entries(query)) {
				if (val != null && typeof val == "object") {
					fd.append(key, JSON.stringify(val));
				} else {
					fd.append(key, val);
				}
			}
			opts.body = fd;
		}
		if (this.bearer) opts.headers = { Authorization: `Bearer ${this.bearer}` };
		const res = await fetch(this.baseUrl + path, {
			method,
			redirect: 'follow',
			...opts
		});
		if (!res.ok) throw HttpError.from(res.status, res.statusText);
		return res.json();
	}
}
