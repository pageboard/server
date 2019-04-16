var dom = require('express-dom');
var Path = require('path');
dom.plugins.form = require('./plugins/form');
dom.plugins.upcache = require('./plugins/upcache');
dom.plugins.report = require('./plugins/report').plugin;
dom.helpers.report = require('./plugins/report').helper;
dom.plugins.bearer = dom.plugins.cookies({
	bearer: true // allow only auth cookie
});

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
	dom.settings.load.plugins.unshift(dom.plugins.bearer);
	dom.settings.load.plugins.unshift(dom.plugins.httpequivs);
	dom.settings.load.plugins.unshift(dom.plugins.upcache);
	dom.settings.load.plugins.unshift(dom.plugins.httplinkpreload);
	dom.settings.load.plugins.unshift(dom.plugins.form);
	dom.settings.helpers.push(dom.helpers.report);
	dom.settings.load.plugins.push(dom.plugins.report);

	Object.assign(dom.pool, {
		max: 8
	}, opt.prerender.pool);

	if (opt.prerender.pool) delete dom.settings.pool;

	dom.clear();

	All.dom = dom; // because we need it asap

	return {
		priority: -Infinity,
		view: function() {}
	};
};

