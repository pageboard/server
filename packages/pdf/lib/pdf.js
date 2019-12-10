exports.plugin = function(page, settings, req, res) {
	// does not really need a polyfill
	settings.scripts.push(`window.ResizeObserver = class {
		disconnect() {}
		observe() {}
		unobserve() {}
	};`);
	return require('express-dom-pdf').plugin(page, settings, req, res);
};

