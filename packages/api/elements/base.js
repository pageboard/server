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
			oneOf: [{
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
		title.textContent = block.data.title || '';
		return doc.body;
	},
	install: function(doc, Pb) {
		// must happen after all el.install methods have been called
		return (new Promise(function(resolve) {
			setTimeout(resolve);
		})).then(function() {
			var list = Pb.view.elements;
			doc.head.insertAdjacentHTML('beforeEnd', "\n" +
				this.filter(list, 'stylesheets').map(function(href) {
					return `<link rel="stylesheet" href="${href}" />`;
				}).join("\n")
			);
			doc.head.insertAdjacentHTML('beforeEnd', "\n" +
				this.filter(list, 'scripts').map(function(src) {
					return `<script src="${src}"></script>`;
				}).join("\n")
			);
		}.bind(this));
	},
	filter: function(elements, prop) {
		var map = {};
		var res = [];
		elements.forEach(function(el) {
			var list = el[prop];
			if (!list) return;
			if (typeof list == "string") list = [list];
			var url, prev;
			for (var i=0; i < list.length; i++) {
				url = list[i];
				prev = map[url];
				if (prev) {
					if (el.priority != null) {
						if (prev.priority == null) {
							// move prev url on top of res
							res = res.filter(function(lurl) {
								return lurl != url;
							});
						} else if (prev.priority != el.priority) {
							console.warn(prop, url, "declared in element", el.name, "with priority", el.priority, "is already declared in element", prev.name, "with priority", prev.priority);
							continue;
						} else {
							continue;
						}
					} else {
						continue;
					}
				}
				map[url] = el;
				res.push(url);
			}
		});
		return res;
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
			oneOf: [{
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
			align = prop.oneOf.find(function(item) {
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

