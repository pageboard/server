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
	var fetchOpts = {
		method: method,
		headers: {
			'Accept': 'application/json'
		},
		credentials: "same-origin"
	};
	var pendings = Pageboard.fetch.pendings;
	if (method == "get") {
		url = Page.format(Object.assign(Page.parse(url), {query: data}));
		var pending = pendings[url];
		if (pending) {
			return pending;
		}
	} else {
		headers['Content-Type'] = 'application/json';
		fetchOpts.body = JSON.stringify(data);
	}

	var p = fetch(url, fetchOpts).then(function(res) {
		if (res.status >= 400) throw new Error(res.statusText);
		return res.json();
	});
	if (method == "get") {
		pendings[url] = p;
		p.finally(function() {
			delete pendings[url];
		});
	}
	return p;
};
Pageboard.fetch.pendings = {};

