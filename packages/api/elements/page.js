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
				// works with sitemap editor to update pages url in a coherent manner
				// see also page.save: the href updater will only change input.name == "href".
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
		},
		metas: {
			title: 'Meta tags',
			type: 'array',
			items: [{
				type: 'object',
				title: 'Meta',
				properties: {
					name: {
						title: 'Name',
						type: 'string'
					},
					value: {
						title: 'Value',
						type: 'string'
					}
				}
			}]
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
		var d = block.data;
		if (d.redirect && d.redirect != d.url && (!d.transition || !d.transition.from)) {
			doc.head.appendChild(doc.dom`<meta http-equiv="Status" content="302 Found">
	<meta http-equiv="Location" content="${d.redirect}">`);
		}
		if (d.metas) {
			d.metas.forEach(function(meta) {
				doc.head.appendChild(doc.dom`<meta name="${meta.name}" content="${meta.value}">`);
			});
		}
		doc.body.setAttribute('block-content', "body");
		var title = doc.head.querySelector('title');
		if (!title) {
			title = doc.createElement('title');
			doc.head.insertBefore(title, doc.head.firstChild);
		}
		var site = Pageboard.site;
		if (site) {
			if (site.favicon) {
				doc.head.appendChild(doc.dom`<link rel="icon" href="${site.favicon}">`);
			}
			if (site.lang) {
				doc.documentElement.lang = site.lang;
			}
		} else {
			console.warn("no site set");
		}
		title.textContent = d.title || '';
		return doc.body;
	}
};

// extend page
Pageboard.elements.notfound = Object.assign({}, Pageboard.elements.page, {
	title: 'Page not found',
	properties: Object.assign({}, Pageboard.elements.page.properties),
	render: function(doc, block, view) {
		doc.head.appendChild(doc.dom`<meta http-equiv="Status" content="404 Not Found">`);
		return Pageboard.elements.page.render(doc, block, view);
	}
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

