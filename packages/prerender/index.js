var dom = require('express-dom');
var expressHref = require('express-href');
var Path = require('path');

module.exports = function(opt) {
	if (!opt.prerender) opt.prerender = {};

	Object.assign(dom.settings, {
		stall: 20000,
		allow: "same-origin",
		cacheDir: Path.join(opt.dirs.cache, "prerender")
	}, opt.prerender);

	Object.assign(dom.pool, {
		max: 8
	}, opt.prerender.pool);

	if (opt.prerender.pool) delete dom.settings.pool;

	dom.clear();

	return {
		view: init
	};
};

function init(All) {
	All.app.set('views', All.opt.statics.root);
	expressHref(All.app);
	// the router is universal and available in pageboard-read
	All.app.get('*', dom('router').load());
};

