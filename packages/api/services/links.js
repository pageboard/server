const { mergeRecursive } = require('../../../src/utils');

module.exports = class LinksService {
	static name = 'links';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	siteRoutes(router) {
		router.get('/favicon.ico',
			this.app.cache.tag('data-:site').for({
				maxAge: '1 day' // this redirection is subject to change
			}),
			({ site }, res) => {
				if (!site || !site.data.favicon) {
					res.sendStatus(204);
				} else {
					res.redirect(site.data.favicon + "?format=ico");
				}
			}
		);

		router.read('/robots.txt', 'links.robot');

		router.get('/.well-known/traffic-advice', (req, res) => {
			res.type('application/trafficadvice+json');
			res.json([{
				"user_agent": "prefetch-proxy",
				"fraction": 1.0
			}]);
		});

		router.get('/sitemap.txt', async (req, res) => {
			const obj = await req.run('page.list', {
				robot: true,
				type: ['page']
			});
			res.type("text/plain");
			res.send(obj.items.map(page => {
				return new URL(page.data.url, req.$url).href;
			}).join('\n'));
		});

		router.get('/sitemap.xml', async (req, res) => {
			const { items } = await req.run('page.list', {
				robot: true,
				type: ['page']
			});
			const { site, $url } = req;
			const { languages = [] } = site.data;

			// https://www.sitemaps.org/protocol.html
			req.res.type('application/xml');

			const xmlAlt = (href, lang) => {
				return `<xhtml:link rel="alternate" hreflang="${lang}" href="${href}~${lang}"/>`;
			};

			const xmlItem = item => {
				const href = (new URL(item.data.url, $url)).href;
				return `<url>
					<loc>${href}</loc>
					<lastmod>${item.updated_at.split('T').shift()}</lastmod>
					${languages.map(lang => xmlAlt(href, lang)).join('\n')}
				</url>`;
			};

			res.send(`<?xml version="1.0" encoding="UTF-8"?>
				<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
					${items.map(item => xmlItem(item)).join('\n')}
				</urlset>`.replace(/\t+/g, ''));
		});

		const { security } = this.opts;
		if (!security) {
			console.info("links.security URL is missing");
			return;
		} else try {
			new URL(security);
		} catch {
			console.info("links.security must be a URL");
			return;
		}
		const securityResponse = Object.entries({
			Contact: security,
			Expires: new Date((new Date().getFullYear() + 1).toString()).toISOString()
		}).map(([key, str]) => `${key}: ${str}`).join('\n');

		router.get('/.well-known/security.txt', (req, res) => {
			res.type("text/plain");
			res.send(securityResponse);
		});
	}

	async robot(req, data) {
		const lines = [];
		const { site, $url } = req;
		const { env = site.data.env } = data;
		if (env == "production") {
			lines.push(`Sitemap: ${new URL("/sitemap.xml", $url)}`);
			lines.push('User-agent: *');
			const { items } = await req.call('page.list', {
				disallow: true,
				type: ['page']
			});
			for (const page of items) {
				lines.push(`Disallow: ${page.data.url}`);
			}
		} else {
			lines.push('User-agent: *');
			lines.push("Disallow: /");
		}
		return lines.join('\n');
	}
	static robot = {
		title: 'Robots.txt',
		$tags: ['data-:site'],
		$private: true,
		$action: 'read',
		properties: {
			env: {
				title: 'Environment',
				type: 'string'
			}
		}
	};

	async set(req, { prefix, items = [] }) {
		// 0. get stored pages
		const { items: olds } = await req.run('links.get', { prefix });
		const oldMap = {};
		for (const item of olds) oldMap[item.id] = item;
		const itemMap = {};
		items.forEach((item, i) => {
			item.data.index = i;
			itemMap[item.id] = item;
		});

		const urls = new Set(items.map(item => item.data.url));
		if (urls.size != items.length) {
			// two urls are colliding
			throw new HttpError.Conflict("Two pages have the same url");
		}
		const additions = [];
		const removals = [];
		const updates = [];
		const redirects = [];
		// which are removed
		for (const old of olds) {
			const item = itemMap[old.id];
			if (!item) {
				removals.push(old.id);
			} else {
				if (!urls.has(old.data.url)) {
					// old url is not replaced
					if (item.data.url.split('/').slice(0, -1).join('/') != prefix) {
						// another prefix - check database
						let exists;
						try {
							await req.run('block.find', { data: {
								url: item.data.url
							}});
							exists = true;
						} catch {
							exists = false;
						}
						if (exists) throw new HttpError.Conflict(`Same url: ${item.data.url}`);
					}
					// redirections
					redirects.push({ url: old.data.url, redirect: item.data.url });
				}
				updates.push(item.id);
			}
		}
		for (const item of items) {
			if (!oldMap[item.id]) additions.push(item.id);
		}
		// check non-removed pages or blocks are referring to it
		// this won't consider shared blocks that are not inserted anywhere but that's fair

		for (const id of removals) {
			const item = oldMap[id];
			if (urls.has(item.data.url)) {
				// new page replace old page with same url
			} else {
				const { count, items } = await req.run('href.referrers', {
					url: item.data.url,
					ids: removals,
					limit: 5
				});
				if (count) throw new HttpError.Conflict(Text`
					There are ${count} links referring to page ${item.data.url}
					${items.map(item => item.type + ' ' + item.id).join(', ')}
				`);
			}
			await req.run('block.del', { id: item.id });
		}
		for (const data of redirects) {
			await req.run('href.change', { from: data.url, to: data.redirect });
			await req.run('block.add', { type: 'redirection', data });
		}
		for (const id of updates) {
			const item = mergeRecursive({}, oldMap[id], itemMap[id]);
			await req.run('block.save', {
				id: item.id,
				type: item.type,
				data: item.data,
				content: item.content,
				lock: item.lock
			});
		}
		for (const id of additions) {
			const item = itemMap[id];
			await req.run('block.add', {
				type: item.type,
				data: item.data,
				content: item.content,
				lock: item.lock
			});
		}
		return {
			updates: updates.length,
			additions: additions.length,
			removals: removals.length,
			redirects: redirects.length
		};
	}
	static set = {
		title: 'Set pages',
		description: 'Add, rename and redirect, delete for a given /prefix',
		$action: 'write',
		properties: {
			prefix: {
				title: 'Url prefix',
				type: 'string',
				format: 'page',
				$helper: "page"
			},
			items: {
				title: 'Items',
				type: 'array',
				items: {
					type: 'object'
				}
			}
		}
	};

	async get(req, { prefix }) {
		return req.run('page.list', { prefix, drafts: true });
	}
	static get = {
		title: 'Get pages',
		$action: 'read',
		properties: {
			prefix: {
				title: 'Url prefix',
				type: 'string',
				format: 'page',
				$helper: "page",
				nullable: true
			}
		}
	};

	async rebuild(req) {
		const pages = await req.run('page.list');
		for (const page of pages.items) {
			if (!page.content.title) {
				console.error("page has no content.title", page);
				continue;
			}
			await req.run('href.add', {
				url: page.data.url
			});
		}
		return {
			count: pages.items.length
		};
	}
	static rebuild = {
		title: 'Rebuild href pages',
		$private: true,
		$action: 'write'
	};
};


