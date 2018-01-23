Page.route(function(state) {
	// this works around createHTMLDocument incompatibilities
	var doc = document.cloneNode(false);
	var html = doc.createElement('html');
	doc.appendChild(html);
	html.appendChild(doc.createElement('head'));
	html.appendChild(doc.createElement('body'));
	// --
	state.document = doc;
	delete window.Pagecut;
	delete window.Pageboard;

	var scripts = [
		"/.pageboard/read/window-page.js",
		"/.pageboard/read/dom-template-strings.js",
		"/.pageboard/pagecut/viewer.js",
		"/.pageboard/read/build.js",
		"/.api/elements.js"
	];

	if (window.parent.Pageboard && window.parent.Pageboard.hook) {
		scripts.unshift('/.pageboard/pagecut/editor.js');
	}

	scripts.forEach(function(src) {
		var node = doc.createElement('script');
		node.setAttribute('src', src);
		doc.head.appendChild(doc.createTextNode('\n'));
		doc.head.appendChild(node);
	});
	return new Promise(function(resolve) {
		// "jump" out of window load event for pageboard/write
		setTimeout(resolve);
	});
});

