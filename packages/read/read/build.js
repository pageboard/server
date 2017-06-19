		// TODO monkey-patch window-page so that Page.state.query has accessors
		// and that after prerendering, if some query parameters were not accessed,
		// a 302 Temporary redirection goes to the same url without those query parameters
		// to setup that redirection, use meta http-equiv="Status" content="302"
if (!window.Pageboard) window.Pageboard = {elements: {}};

Page.build(function(state) {
	// conveniently export doc.dom from dom-template-strings
	Document.prototype.dom = dom;
	var elements = Pageboard.elements;
	Object.assign(Pagecut.modules, elements);
	var viewer = Pagecut.viewerInstance = new Pagecut.Viewer();
	var page = state.data.page;
	var frag = viewer.modules.id.from(page);
	if (frag.nodeName != "BODY") throw new Error("Page renderer should fill document and return body");
	var doc = frag.ownerDocument;

	fillModules(doc, elements, 'stylesheets', function(doc, href) {
		return doc.dom`<link rel="stylesheet" href="${href}" />`;
	});
	fillModules(doc, elements, 'scripts', function(doc, src) {
		return doc.dom`<script src="${src}"></script>`;
	});

	return Page.importDocument(doc, true); // noload

	function fillModules(doc, modules, what, builder) {
		var map = {};
		Object.keys(modules).forEach(function(name) {
			var mod = modules[name];
			if (mod[what]) mod[what].forEach(function(url) {
				if (map[url]) return;
				map[url] = true;
				doc.head.appendChild(builder(doc, url));
			});
		});
	}
});
