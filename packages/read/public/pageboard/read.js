Page.route(function(state) {
	return GET('/api/page', {
		url: state.pathname
	}).then(function(page) {
		// conveniently export doc.dom from dom-template-strings
		Document.prototype.dom = dom;

		var viewer = Pagecut.viewerInstance = new Pagecut.Viewer();

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
		console.error(err);
		var params = {
			code: err.statusCode || err.code || 500,
			message: err.message || err.toString()
		};
		/*
		document.location = Page.format({
			pathname: '/error',
			query: params
		});
		*/
		document.body.innerHTML = '<h1>Error' + params.code + '</h1>' +
			'<p>' + params.message + '</p>';
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

