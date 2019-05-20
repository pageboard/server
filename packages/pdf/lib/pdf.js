var dom = require('express-dom');

exports.helper = function(mw, settings, request, response) {
	if (request.path.endsWith('.pdf') == false) return;
	settings.load.plugins = [
		dom.plugins.upcache,
		dom.plugins.bearer,
		dom.plugins.pdf
	];
};

exports.plugin = require('express-dom-pdf').plugin;

