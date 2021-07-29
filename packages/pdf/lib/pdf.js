exports.plugin = function(page, settings, req, res) {
	// does not really need a polyfill
	settings.scripts.push(`window.ResizeObserver = class {
		disconnect() {}
		observe() {}
		unobserve() {}
	};`);
	if (!settings.pdf) settings.pdf = {};
	settings.pdf.mappings = function (cb) {
		/* global Page */
		Page.finish().then(function (state) {
			if (Page.serialize) return Page.serialize(state);
			else return {
				mime: "text/html",
				body: '<!DOCTYPE html>\n' + document.documentElement.outerHTML
			};
		}).then(function (obj) {
			cb(null, obj);
		}).catch(cb);
	};
	return require('express-dom-pdf').plugin(page, settings, req, res);
};
