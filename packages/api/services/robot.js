module.exports = class RobotService {
	static name = 'robot';

	apiRoutes(app, server) {
		server.get('/robots.txt', app.cache.tag('data-:site'), async (req, res) => {
			const txt = await req.run('robot.txt');
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

	async ping(req) {
		const sitemap = new URL("/.well-known/sitemap.xml", req.site.url);
		const url = new URL("https://www.google.com/ping");
		url.searchParams.set('sitemap', sitemap.href);
		const response = await fetch(url);
		if (!response.ok) throw new HttpError[response.status](response.statusText);
	}
	static ping = {
		title: 'Ping crawlers with new sitemap',
		$lock: true,
		$action: 'write'
	};

	async txt(req, data) {
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
	static txt = {
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
};

