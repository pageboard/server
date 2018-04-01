Pageboard.elements.page = {
	priority: -100,
	replaces: 'doc',
	title: 'Page',
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
				name: 'pageUrl'
			}
		},
		redirect: {
			title: 'Redirect',
			anyOf: [{
				type: "null"
			}, {
				type: "string",
				format: "uri"
			}, {
				type: "string",
				pattern: "^(/[a-zA-Z0-9-.]*)+$" // notice the absence of underscore
			}],
			input: {
				name: 'href',
				filter: {
					type: ["link", "file", "archive"]
				}
			}
		},
		index: {
			type: "integer",
			default: 0,
			minimum: 0
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
			doc.head.appendChild(doc.dom`<meta http-equiv="Status" content="302 Found">
	<meta http-equiv="Location" content="${block.data.redirect}">`);
		}
		doc.body.setAttribute('block-content', "body");
		var title = doc.head.querySelector('title');
		if (!title) {
			title = doc.createElement('title');
			doc.head.insertBefore(title, doc.head.firstChild);
		}
		var site = block.site;
		if (site) {
			if (site.favicon) {
				doc.head.appendChild(doc.dom`<link rel="icon" href="${block.site.favicon}">`);
			}
			if (site.lang) {
				doc.documentElement.lang = site.lang;
			}
		}
		title.textContent = block.data.title || '';
		return doc.body;
	},
	install: function(doc, page, view) {
		// must happen after all el.install methods have been called
		return (new Promise(function(resolve) {
			setTimeout(resolve);
		})).then(function() {
			view.elements.forEach(function(el) {
				if (el.name == this.name) return;
				if (el.scripts) Array.prototype.push.apply(this.scripts, el.scripts);
				if (el.stylesheets) Array.prototype.push.apply(this.stylesheets, el.stylesheets);
			}, this);
			doc.head.insertAdjacentHTML('beforeEnd', "\n" +
				this.stylesheets.map(function(href) {
					return `<link rel="stylesheet" href="${href}" />`;
				}).join("\n")
			);
			doc.head.insertAdjacentHTML('beforeEnd', "\n" +
				this.scripts.map(function(src) {
					return `<script src="${src}"></script>`;
				}).join("\n")
			);
		}.bind(this));
	}
};

// extend page
Pageboard.elements.notfound = Object.assign({}, Pageboard.elements.page, {
	title: 'Page not found',
	properties: Object.assign({}, Pageboard.elements.page.properties),
	render: function(doc, block, view) {
		doc.head.appendChild(doc.dom`<meta http-equiv="Status" content="404 Not Found">`);
		return Pageboard.elements.page.render(doc, block, view);
	},
	install: null
});
delete Pageboard.elements.notfound.properties.url;

Pageboard.elements.paragraph = {
	title: "Paragraph",
	priority: -10,
	tag: 'p',
	isolating: false,
	properties: {
		align: {
			title: 'Align',
			default: "left",
			anyOf: [{
				const: "left",
				title: "left",
				icon: '<i class="icon align left"></i>'
			}, {
				const: "center",
				title: "center",
				icon: '<i class="icon align center"></i>'
			}, {
				const: "right",
				title: "right",
				icon: '<i class="icon align right"></i>'
			}, {
				const: "justify",
				title: "justify",
				icon: '<i class="icon align justify"></i>'
			}]
		}
	},
	parse: function(dom) {
		var align = "left";
		var prop = Pageboard.elements.paragraph.properties.align;
		if (dom.classList.contains("aligned")) {
			align = prop.anyOf.find(function(item) {
				return dom.classList.contains(item.const);
			});
			if (!align) align = prop.default;
			else align = align.const;
		}
		return {align: align};
	},
	contents: "inline*",
	group: "block",
	inplace: true,
	icon: '<i class="icon paragraph"></i>',
	render: function(doc, block) {
		return doc.dom`<p class="${block.data.align || 'left'} aligned"></p>`;
	}
};

