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
	if (cla.init) cla.init();
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
		fetchOpts.headers['Content-Type'] = 'application/json';
		fetchOpts.body = JSON.stringify(data);
	}

	var p = fetch(url, fetchOpts).then(function(res) {
		if (res.status >= 400) {
			return res.text().then(function(text) {
				var err = new Error(res.statusText);
				err.body = text;
				throw err;
			});
		}
		if (res.status == 204) return null;
		return res.json();
	});
	if (method == "get") {
		pendings[url] = p;
		p.catch(function(err) {
			delete pendings[url];
			throw err;
		}).then(function(r) {
			delete pendings[url];
			return r;
		});
	}
	return p;
};
Pageboard.fetch.pendings = {};

Pageboard.debounce = function(func, wait, immediate) {
	var timeout, args, context, timestamp, result;
	if (null == wait) wait = 100;

	function later() {
		var last = Date.now() - timestamp;

		if (last < wait && last >= 0) {
			timeout = setTimeout(later, wait - last);
		} else {
			timeout = null;
			if (!immediate) {
				result = func.apply(context, args);
				context = args = null;
			}
		}
	}

	function debounced() {
		context = this;
		args = arguments;
		timestamp = Date.now();
		var callNow = immediate && !timeout;
		if (!timeout) timeout = setTimeout(later, wait);
		if (callNow) {
			result = func.apply(context, args);
			context = args = null;
		}
		return result;
	}

	debounced.clear = function() {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
	};

	debounced.flush = function() {
		if (timeout) {
			result = func.apply(context, args);
			context = args = null;

			clearTimeout(timeout);
			timeout = null;
		}
	};

	return debounced;
};

(function() {
if (document.visibilityState == "prerender") return;
if (Pageboard.adv) return;
if (window.parent.Pageboard && window.parent.Pageboard.adv) return;
Pageboard.adv = true;
console.log("Built and served by Pageboard");
})();
