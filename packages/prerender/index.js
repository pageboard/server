var dom = require('express-dom');
var expressHref = require('express-href');
var Path = require('path');

module.exports = function(config) {
	if (!config.prerender) config.prerender = {};

	Object.assign(dom.settings, {
		stall: 20000,
		allow: "same-origin",
		cacheDir: Path.join(config.dirs.cache, "prerender")
	}, config.prerender);

	Object.assign(dom.pool, {
		max: 8
	}, config.prerender.pool);

	if (config.prerender.pool) delete dom.settings.pool;

	dom.clear();

	return {
		view: init
	};
};

function init(app, modules, config) {
	app.set('views', config.statics.root);
	expressHref(app);
	// the router is universal and available in pageboard-read
	app.get('*', dom('router').load());
};

