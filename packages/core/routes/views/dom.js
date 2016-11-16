var dom = require('express-dom');
var tag = require('upcache/tag');
var expressHref = require('express-href');

exports.route = function(app, api, config) {
	expressHref(app);

	Object.assign(dom.settings, {
		stall: 20000,
		allow: "same-origin"
	}, config.dom);

	Object.assign(dom.pool, {
		max: 8
	}, config.dom.pool);

	if (config.dom && config.dom.pool) delete dom.settings.pool;

	dom.helpers.bundle = require('./plugins/bundledom')(
		config.statics.path
		process.env.DEVELOP ? "" : "bundles"
	);

	app.get('*', dom(template, dom.helpers.bundle).load());
};

exports.template = function(mw, settings, req, res) {
	// get page block
	// return template file name
};
