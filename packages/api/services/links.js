const { mergeRecursive } = require('../../../src/utils');

module.exports = class LinksService {
	static name = 'links';

	apiRoutes(app, server) {
		server.get('/robots.txt', app.cache.tag('data-:site'), async (req, res) => {
			const txt = await req.run('links.robot');
			res.type('text/plain');
			res.send(txt);
		});

		server.get('/.well-known/sitemap.txt', app.cache.tag('data-:site'), async (req, res) => {
			const obj = await req.run('page.list', {
				robot: true,
				type: ['page']
			});
			res.type('text/plain');
			res.send(app.responseFilter.run(req, obj).items.map(page => {
				return new URL(page.data.url, req.site.url).href;
			}).join('\n'));
		});

		server.get('/.well-known/sitemap.xml', app.cache.tag('data-:site'), async (req, res) => {
			const obj = await req.run('page.list', {
				robot: true,
				type: ['page']
			});
			const { items } = app.responseFilter.run(req, obj);
			const { site } = req;
			const { languages = [] } = site.data;

			// https://www.sitemaps.org/protocol.html
			res.type('application/xml');

			const xmlAlt = (href, lang) => {
				return `<xhtml:link rel="alternate" hreflang="${lang}" href="${href}~${lang}"/>`;
			};

			const xmlItem = item => {
				const href = (new URL(item.data.url, site.url)).href;
				return `<url>
					<loc>${href}</loc>
					<lastmod>${item.updated_at.split('T').shift()}</lastmod>
					${languages.map(lang => xmlAlt(href, lang)).join('\n')}
				</url>`;
			};

			res.send(`<?xml version="1.0" encoding="UTF-8"?>
				<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
					${items.map(item => xmlItem(item)).join('\n')}
				</urlset>`.replace(/\t+/g, '')
			);
		});
	}

	async robot(req, data) {
		const lines = [];
		const { site } = req;
		const { env = site.data.env } = data;
		if (env == "production") {
			lines.push(`Sitemap: ${new URL("/.well-known/sitemap.xml", site.url)}`);
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
		title: 'Get robots.txt',
		$lock: true,
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
						} catch (e) {
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
				const count = await req.run('href.referrers', {
					url: item.data.url,
					ids: removals,
					limit: 0
				});
				if (count) throw new HttpError.Conflict(Text`
					There are ${count} links referring to page ${item.data.url}
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
			await req.run('block.save', item);
		}
		for (const id of additions) {
			await req.run('block.add', itemMap[id]);
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
		$action: 'write',
		properties: {
			prefix: {
				title: 'Url prefix',
				type: 'string',
				format: 'pathname',
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
				format: 'pathname',
				$helper: "page"
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
		title: 'Reprovision all hrefs for pages',
		$lock: true,
		$action: 'write'
	};
};


