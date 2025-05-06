module.exports = class ProxyService {
	static name = 'proxy';
	constructor(app) {
		this.app = app;
	}

	async get(req, data) {
		this.app.cache.for(data.ttl)(req, req.res, () => { });
		const url = new URL(data.url);
		if (data.query) for (const [key, val] of Object.entries(data.query)) {
			url.searchParams.append(key, val);
		}
		const res = await fetch(data.url);
		if (!res.ok) throw HttpError.from(res.status, res.statusText);
		return res.json();
	}
	static get = {
		title: 'Get',
		$action: 'read',
		properties: {
			url: {
				title: 'URL',
				type: 'string',
				format: 'uri-reference'
			},
			query: {
				title: 'Query',
				type: 'object',
				nullable: true
			},
			ttl: {
				title: 'Time To Live',
				description: 'Cache in seconds',
				type: 'integer',
				minimum: 1,
				default: 30
			}
		}
	};
};
