		// TODO monkey-patch window-page so that Page.state.query has accessors
		// and that after prerendering, if some query parameters were not accessed,
		// a 302 Temporary redirection goes to the same url without those query parameters
		// to setup that redirection, use meta http-equiv="Status" content="302"
if (!window.Pageboard) window.Pageboard = {elements: {}};

Page.build(function(state) {
	var viewer = Pagecut.viewerInstance = new Pagecut.Viewer({
		elements: Pageboard.elements
	});
	var page = state.data.page;
	return viewer.from(page).then(function(body) {
		if (body.nodeName != "BODY") throw new Error("Page renderer should fill document and return body");
		var doc = body.ownerDocument;
		doc.documentElement.replaceChild(body, doc.body);

		filterModules(viewer.elements, 'stylesheets').forEach(function(href) {
			doc.head.appendChild(doc.dom`\n <link rel="stylesheet" href="${href}" />`);
		});
		filterModules(viewer.elements, 'scripts').forEach(function(src) {
			doc.head.appendChild(doc.dom`\n <script src="${src}"></script>`);
		});

		// used to be (doc, true) but this causes some problems with custom elements
		return Page.importDocument(doc);
	});

	function filterModules(modules, prop) {
		var map = {};
		var res = [];
		modules.forEach(function(mod) {
			var list = mod[prop];
			if (!list) return;
			var url;
			for (var i=0; i < list.length; i++) {
				url = list[i];
				if (map[url]) continue;
				map[url] = true;
				res.push(url);
			}
		});
		return res;
	}
});
