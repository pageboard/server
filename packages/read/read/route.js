		// TODO if query.develop has a value
		// if there is no form with input id,
		// if there is no query element instantiated on the page
		// then do 302 Temporary redirection goes to the same url without those query parameters
		// to setup that redirection, use meta http-equiv="Status" content="302"

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
			if (body.nodeName != "BODY") throw new Error("Page renderer should fill document and return body");
			var doc = body.ownerDocument;
			doc.documentElement.replaceChild(body, doc.body);
			if (window.parent.Pageboard && window.parent.Pageboard.hook) {
				doc.head.insertAdjacentHTML('beforeEnd', `\n<script src="/.pageboard/pagecut/editor.js"></script>`);
				window.parent.Pageboard.hook(doc);
			}

			doc.head.insertAdjacentHTML('beforeEnd', "\n" +
				filterModules(Pageboard.view, 'stylesheets').map(function(href) {
					return `<link rel="stylesheet" href="${href}" />`;
				}).join("\n")
			);
			doc.head.insertAdjacentHTML('beforeEnd', "\n" +
				filterModules(Pageboard.view, 'scripts').map(function(src) {
					return `<script src="${src}"></script>`;
				}).join("\n")
			);
			if (window.parent.Pageboard && window.parent.Pageboard.helpers) {
				doc.head.insertAdjacentHTML('beforeEnd',
					filterModules(Pageboard.view, 'helpers').map(function(src) {
						return `<script src="${src}"></script>`;
					}).join("\n")
				);
			}
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
						} else {
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
