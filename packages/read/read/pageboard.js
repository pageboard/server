if (!window.Pageboard) window.Pageboard = {};

// this works in babel 6, see postinstall-js
class HTMLCustomElement extends HTMLElement {
	constructor(me) {
		me = super(me);
		me.init();
		return me;
	}
	init() {}
}
HTMLCustomElement.define = function(name, cla) {
	if (!window.customElements.get(name)) window.customElements.define(name, cla);
};

Pageboard.fetch = function(method, url, data) {
	method = method.toLowerCase();
	var doCache = document.body.isContentEditable == false && method == "get";
	var fetchOpts = {
		method: method,
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json'
		},
		credentials: "same-origin"
	};
	if (method == "get") {
		url = Page.format(Object.assign(Page.parse(url), {query: data}));
	} else {
		fetchOpts.body = JSON.stringify(data);
	}
	if (doCache) {
		var cached = Pageboard.fetch.cache[url];
		if (cached) {
			return cached;
		}
	}

	var p = fetch(url, fetchOpts).then(function(res) {
		if (res.status >= 400) throw new Error(res.statusText);
		return res.json();
	});
	if (doCache) Pageboard.fetch.cache[url] = p;
	return p;
};
Pageboard.fetch.cache = {};

