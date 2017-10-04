		// TODO monkey-patch window-page so that Page.state.query has accessors
		// and that after prerendering, if some query parameters were not accessed,
		// a 302 Temporary redirection goes to the same url without those query parameters
		// to setup that redirection, use meta http-equiv="Status" content="302"
if (!window.Pageboard) window.Pageboard = {elements: {}};

Page.build(function(state) {
	return GET('/.api/page', {
		url: state.pathname
	}).catch(function(err) {
		// emergency error handling
		document.body.textContent = `${err.code} ${err}`;
		document.title = err.code;
		document.head.insertAdjacentHTML('afterBegin', `<meta http-equiv="Status" content="${err.code} ${err}">`);
		throw err;
	}).then(function(page) {
		Pageboard.view = new Pagecut.Viewer({
			elements: Pageboard.elements
		});
		return Pageboard.view.from(page).then(function(body) {
			if (body.nodeName != "BODY") throw new Error("Page renderer should fill document and return body");
			var doc = body.ownerDocument;
			doc.documentElement.replaceChild(body, doc.body);

			filterModules(Pageboard.view, 'stylesheets').forEach(function(href) {
				doc.head.appendChild(doc.dom`<link rel="stylesheet" href="${href}" />`);
			});
			filterModules(Pageboard.view, 'scripts').forEach(function(src) {
				doc.head.appendChild(doc.dom`<script src="${src}"></script>`);
			});

			// used to be (doc, true) but this causes some problems with custom elements
			return Page.importDocument(doc);
		});
	});

	function filterModules(modules, prop) {
		var map = {};
		var res = [];
		modules.elements.forEach(function(mod) {
			var list = mod[prop];
			if (!list) return;
			var url, prev;
			for (var i=0; i < list.length; i++) {
				url = list[i];
				prev = map[url];
				if (prev) {
					if (mod.priority != null) {
						if (prev.priority == null) {
							// move prev url on top of res
							res = res.filter(function(lurl) {
								return lurl != url;
							});
						} else if (prev.priority != mod.priority) {
							console.warn(prop, url, "declared in element", mod.name, "with priority", mod.priority, "is already declared in element", prev.name, "with priority", prev.priority);
							continue;
						}
					} else {
						continue;
					}
				}
				map[url] = mod;
				res.push(url);
			}
		});
		return res;
	}
});
