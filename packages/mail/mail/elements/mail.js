Pageboard.elements.mail = {
	priority: -100,
	replaces: 'doc',
	title: 'Mail',
	group: 'page',
	standalone: true, // besides site, can be child of zero or more parents
	properties: {
		title: {
			title: 'Title',
			type: ['string', 'null'],
			input: {
				name: 'pageTitle'
			}
		},
		url: {
			title: 'Address',
			type: "string",
			pattern: "^(/[a-zA-Z0-9-.]*)+$", // notice the absence of underscore
			input: {
				// works with sitemap editor to update pages url in a coherent manner
				// see also page.save: the href updater will only change input.name == "href".
				name: 'pageUrl'
			}
		}
	},
	contents: {
		body: {
			spec: 'text*',
			title: 'body'
		}
	},
	icon: '<i class="icon file outline"></i>',
	render: function(doc, block) {
		var d = block.data;
		doc.body.setAttribute('block-content', "body");
		var title = doc.head.querySelector('title');
		if (!title) {
			title = doc.createElement('title');
			doc.head.insertBefore(title, doc.head.firstChild);
		}
		var site = Pageboard.site;
		if (site) {
			if (site.lang) {
				doc.documentElement.lang = site.lang;
			}
		} else {
			console.warn("no site set");
		}
		title.textContent = d.title || '';
		return doc.body;
	},
	scripts: [
		'/.pageboard/read/custom-elements.min.js',
		'/.pageboard/read/pageboard.js',
		'/.pageboard/read/window-page.js'
	],
	stylesheets: [
		'../ui/mail.css'
	]
};

