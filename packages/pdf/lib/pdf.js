exports.plugin = function (page, settings, req, res) {
	settings.stall = 8000;
	// does not really need a polyfill
	settings.scripts.push(`window.ResizeObserver = class {
		disconnect() {}
		observe() {}
		unobserve() {}
	};`);
	if (!settings.pdf) settings.pdf = {};
	settings.pdf.mappings = function (cb) {
		/* global Page */
		Page.finish().then((state) => {
			if (Page.serialize) return Page.serialize(state);
			else return {
				mime: "text/html",
				body: '<!DOCTYPE html>\n' + document.documentElement.outerHTML
			};
		}).then((obj) => {
			cb(null, obj);
		}).catch(cb);
	};
	return require('express-dom-pdf').plugin(page, settings, req, res);
};
