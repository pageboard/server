Page.route(function(state) {
	// conveniently export doc.dom from dom-template-strings
	Document.prototype.dom = dom;
	return GET('/api/page', {
		url: state.pathname
	}).catch(function(err) {
		// emergency error handling
		document.body.textContent = `${err.code} ${err}`;
		document.title = err.code;
		throw err;
	}).then(function(page) {
		var viewer = Pagecut.viewerInstance = new Pagecut.Viewer();

		// TODO monkey-patch window-page so that Page.state.query has accessors
		// and that after prerendering, if some query parameters were not accessed,
		// a 302 Temporary redirection goes to the same url without those query parameters
		// to setup that redirection, use meta http-equiv="Status" content="302"
		var frag = viewer.modules.id.from(page);
		if (frag.nodeName != "BODY") throw new Error("Page renderer should fill document and return body");
		state.document = frag.ownerDocument;
		mergeAssets(state.document, Pagecut.modules, 'stylesheets', function(doc, href) {
			return doc.dom`<link rel="stylesheet" href="${href}" />`;
		});
		mergeAssets(state.document, Pagecut.modules, 'scripts', function(doc, src) {
			return doc.dom`<script src="${src}"></script>`;
		});
	}).catch(function(err) {
		// log client-side errors
		if (err) console.error(err);
	});

	function mergeAssets(doc, modules, what, builder) {
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

