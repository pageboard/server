Page.route(function(state) {
	return GET('/api/page', {
		url: state.pathname
	}).then(function(page) {

		// page children are
		// 1) all single blocks that are on this page
		// 2) all shared blocks that are on this page

		// single blocks do not have other relations stored in db
		// shared blocks are related to all the blocks they contain, like a page do

		// the relations of inclusions between blocks is only stored in the html
		// only the relations needed to rebuild pages or shared blocks are stored in db

		// as a consequence, a shared block cannot contain shared blocks
		// and there is no such thing as a shared page
		// however, when copying a block, the shared blocks are kept shared

		var viewer = Pagecut.viewerInstance = new Pagecut.Viewer();

		var stylesheets = collectStylesheets({}, document);
		var frag = viewer.modules.id.from(page);
		if (frag.nodeName != "BODY") throw new Error("Page renderer should fill document and return body");
		state.document = frag.ownerDocument.cloneNode(true);
		state.document.dom = dom.bind(state.document);
		setStylesheets(stylesheets, state.document);
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

	function collectStylesheets(sheets, doc) {
		var nodes = Array.from(doc.querySelectorAll('link[rel="import"],link[rel="stylesheet"]'));
		nodes.forEach(function(node) {
			if (node.import) collectStylesheets(sheets, node.import);
			else sheets[node.href] = node.getAttribute('href');
		});
		return sheets;
	}

	function setStylesheets(map, doc) {
		var pivot = doc.head.querySelector('script');
		var href, sheet;
		for (var k in map) {
			href = map[k];
			sheet = doc.createElement('link');
			sheet.rel = "stylesheet";
			sheet.setAttribute('href', href);
			if (pivot) doc.head.insertBefore(sheet, pivot);
			else doc.head.appendChild(sheet);
		}
	}
});
