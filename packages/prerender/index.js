var dom = require('express-dom');
var expressHref = require('express-href');

exports.view = function(app, api, config) {
	app.set('views', config.statics.root);
	return init;
};

function init(app, api, config) {
	expressHref(app);

	if (!config.dom) config.dom = {};

	Object.assign(dom.settings, {
		stall: 20000,
		allow: "same-origin"
	}, config.dom);

	Object.assign(dom.pool, {
		max: 8
	}, config.dom.pool);

	if (config.dom && config.dom.pool) delete dom.settings.pool;

	dom.helpers.bundle = require('./plugins/bundledom')(
		config.statics.root,
		process.env.DEVELOP ? "" : "bundles"
	);

	app.get('*', dom(template, dom.helpers.bundle).load());
};

function template(mw, settings, req, res) {
	// get page block
	// return template file name
	return 'front';
}
