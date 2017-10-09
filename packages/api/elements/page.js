
Pageboard.elements.page = {
	priority: -100,
	title: 'Page',
	group: 'page',
	standalone: true, // besides site, can be child of zero or more parents
	properties: {
		title: {
			title: 'Title',
			type: ['string', 'null']
		},
		url: {
			title: 'Address',
			type: "string",
			pattern: "(\/[a-zA-Z0-9-.]*)+"
		},
		redirect: {
			title: 'Redirect',
			type: "string",
			pattern: "(\/[a-zA-Z0-9-.]*)+"
		}
	},
	contents: {
		body: {
			spec: 'block+',
			title: 'body'
		}
	},
	icon: '<i class="icon file outline"></i>',
	render: function(doc, block) {
		if (block.data.redirect && block.data.redirect != block.data.url) {
			doc.head.insertAdjacentHTML('beforeend', '<meta http-equiv="Status" content="302 Found">\
<meta http-equiv="Location" content="${block.data.redirect}">');
		}
		doc.body.setAttribute('block-content', "body");
		var title = doc.head.querySelector('title');
		if (!title) {
			title = doc.createElement('title');
			doc.head.insertBefore(title, doc.head.firstChild);
		}
		title.textContent = block.data.title || '';
		return doc.body;
	}
};

// extend page
Pageboard.elements.notfound = Object.assign({}, Pageboard.elements.page, {
	title: 'Page not found',
	properties: {
		title: {
			title: 'Title',
			type: ['string', 'null']
		}
	},
	render: function(doc, block) {
		doc.head.insertAdjacentHTML('beforeend', '<meta http-equiv="Status" content="404 Not Found">');
		return Pageboard.elements.page.render(doc, block);
	}
});

