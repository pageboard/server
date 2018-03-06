Page.route(function(state) {
	return fetch('/.api/page?url=' + encodeURIComponent(state.pathname), {
		headers: {
			'Accept': 'application/json'
		}
	}).then(function(res) {
		if (res.status >= 400) {
			var err = new Error(res.statusText);
			err.code = res.status;
			throw err;
		}
		return res.json();
	}).catch(function(err) {
		// emergency error handling
		// TODO fix err.code here
		document.body.textContent = `${err.code} ${err}`;
		document.title = err.code;
		document.head.insertAdjacentHTML('afterBegin', `<meta http-equiv="Status" content="${err.code} ${err}">`);
		throw err;
	}).then(function(page) {
		Pageboard.view = new Pagecut.Viewer({
			elements: Pageboard.elements
		});
		return Pageboard.view.from(page).then(function(body) {
			if (body.nodeName != "BODY") {
				throw new Error("Element page.render did not return a body node");
			}
			var doc = body.ownerDocument;
			doc.documentElement.replaceChild(body, doc.body);

			if (window.parent.Pageboard && window.parent.Pageboard.write) {
				Pageboard.write = true;
				window.parent.Pageboard.install(doc);
			}

			return Promise.all(Pageboard.view.elements.map(function(el) {
				if (el.install) return el.install.call(el, doc, page, Pageboard.view);
			})).then(function() {
				state.document = doc;
			});
		});
	});
});
