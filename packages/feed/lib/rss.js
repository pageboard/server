const { Feed } = require("feed");
const dom = require('express-dom');

exports.helper = function(mw, settings, request, response) {
	if (request.path.endsWith('.rss') == false) return;
	settings.load.plugins = [
		dom.plugins.upcache,
		dom.plugins.hide,
		dom.plugins.httpequivs,
		dom.plugins.bearer,
		dom.plugins.prerender,
		dom.plugins.rss
	];
};

exports.plugin = function(page, settings, request, response) {
	page.when('idle', function() {
		return page.run(function(done) {
			var doc = document;
			var dloc = doc.location;
			var base = dloc.protocol + '//' + dloc.host;

			function absolute(url) {
				return (new URL(url, base)).href;
			}
			var categories = [];
			var feeds = Array.from(doc.querySelectorAll('[block-type="feed"]')).map((node) => {
				var preview = node.querySelector('[block-content="preview"] [block-type="image"]');
				var topics = (node.getAttribute('feed-topics') || '').split(' - ');
				topics.forEach((topic) => {
					topic = topic.trim();
					if (topic && !categories.includes(topic)) categories.push(topic);
				});
				return {
					title: node.querySelector('[data-label="title"]').innerText,
					link: absolute(node.getAttribute('feed-url')),
					date: node.getAttribute('feed-publication'),
					content: node.querySelector('[block-content="section"]').innerHTML,
					image: preview ? absolute(preview.getAttribute('url')) : null
				};
			});
			var url = dloc.toString();
			var feed = {
				title: doc.title,
				link: url.replace('.rss', ''),
				generator: 'pageboard',
				feedLinks: {
					atom: url
				},
				categories: categories
			};

			done(null, {
				errors: doc.errors && doc.errors.length ? doc.errors : null,
				feed: feed,
				feeds: feeds
			});
		}).then(function(obj) {
			if (obj.errors) console.error(obj.errors);
			settings.output = false;
			const feed = new Feed(obj.feed);
			obj.feeds.forEach((item) => {
				item.date = new Date(item.date);
				feed.addItem(item);
			});
			response.set('Content-Type', "application/xml");
			response.send(feed.rss2());
		}).catch(function(err) {
			console.error(err);
			settings.output = err;
			response.status(500);
		});
	});
};
/*
function(site, page, list) {
	var updated_at = 0;
	list.forEach(function(item) {
		if (!item.data.title) return;
		if (item.updated_at > updated_at) updated_at = item.updated_at;
	});
	const feed = new Feed({
		title: `${page.data.title} - ${site.data.title}`,
		description: page.data.description,
		link: site.href + page.data.url + '.rss',
		// image: "http://example.com/image.png",
		// favicon: "http://example.com/favicon.ico",
		// copyright: "All rights reserved 2013, John Doe",
		updated: updated_at, // defaults today
		generator: "pageboard", // optional, default = 'Feed for Node.js'
		categories: page.data.keywords,
		// feedLinks: {
		// 	json: "https://example.com/json",
		// 	atom: "https://example.com/atom"
		// },
		// author: {
		// 	name: "John Doe",
		// 	email: "johndoe@example.com",
		// 	link: "https://example.com/johndoe"
		// }
	});

	list.forEach(function(post) {
		if (!post.data.title) return;
		feed.addItem({
			title: post.data.title,
			link: site.href + post.data.url,
			description: post.data.description,
			// content: post.content,
			// author: [
			// 	{
			// 		name: "Jane Doe",
			// 		email: "janedoe@example.com",
			// 		link: "https://example.com/janedoe"
			// 	},
			// 	{
			// 		name: "Joe Smith",
			// 		email: "joesmith@example.com",
			// 		link: "https://example.com/joesmith"
			// 	}
			// ],
			// contributor: [
			// 	{
			// 		name: "Shawn Kemp",
			// 		email: "shawnkemp@example.com",
			// 		link: "https://example.com/shawnkemp"
			// 	},
			// 	{
			// 		name: "Reggie Miller",
			// 		email: "reggiemiller@example.com",
			// 		link: "https://example.com/reggiemiller"
			// 	}
			// ],
			date: post.updated_at,
			// image: post.image
		});
	});
	return feed;
}
*/
