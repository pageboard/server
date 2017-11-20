var dom = require('express-dom');
var expressHref = require('express-href');
var Path = require('path');

module.exports = function(opt) {
	if (!opt.prerender) opt.prerender = {};
	if (opt.develop) {
		opt.prerender.develop = true;
		opt.prerender.cacheModel = "none";
	}

	opt.prerender.console = true;

	Object.assign(dom.settings, {
		stall: 20000,
		allow: "same-origin",
		cacheDir: Path.join(opt.dirs.cache, "prerender")
	}, opt.prerender);

	dom.settings.helpers.push(dom.helpers.develop);
	dom.settings.load.plugins.unshift(dom.plugins.httpequivs);
	dom.settings.load.plugins.unshift(dom.plugins.httplinkpreload);

	Object.assign(dom.pool, {
		max: 8
	}, opt.prerender.pool);

	if (opt.prerender.pool) delete dom.settings.pool;

	dom.clear();

	return {
		priority: -Infinity,
		view: init
	};
};

function init(All) {
	var views = [All.opt.statics.root];
	if (All.opt.statics.runtime != All.opt.statics.root) views.push(All.opt.statics.runtime);
	All.app.set('views', views);
	expressHref(All.app);
	All.dom = dom;
};

