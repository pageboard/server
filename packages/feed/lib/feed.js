const { Feed } = require("feed");

module.exports = function(site, page, list) {
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
};

