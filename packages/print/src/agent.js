module.exports = class BearerAgent {
	constructor(baseUrl) {
		this.baseUrl = baseUrl;
	}
	async fetch(path, method = "get", query = {}) {
		const opts = {};
		if (!Object.isEmpty(query)) {
			const fd = new FormData();
			for (const [key, val] of Object.entries(query)) {
				fd.append(key, val);
			}
			opts.body = fd;
		}
		if (this.bearer) opts.headers = { Authorization: `Bearer ${this.bearer}` };
		const res = await fetch(this.baseUrl + path, {
			method,
			redirect: 'follow',
			...opts
		});
		if (!res.ok) throw new HttpError[res.status](res.statusText);
		return res.json();
	}
};
