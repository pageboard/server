Page.route(function(state) {
	// this works around createHTMLDocument incompatibilities
	var doc = document.cloneNode(false);
	var html = doc.createElement('html');
	doc.appendChild(html);
	html.appendChild(doc.createElement('head'));
	html.appendChild(doc.createElement('body'));
	// --
	state.document = doc;

	var scripts = [
		"/.pageboard/read/window-page.js",
		"/.pageboard/read/dom-template-strings.js",
		"/.pageboard/pagecut/viewer.js",
		"/.pageboard/read/build.js",
		"/.api/elements.js"
	];

	scripts.forEach(function(src) {
		var node = doc.createElement('script');
		node.setAttribute('src', src);
		doc.head.appendChild(doc.createTextNode('\n'));
		doc.head.appendChild(node);
	});
});

