module.exports = function(opt) {
	opt.statics.mounts.push(__dirname + '/public');
	return {
		view: init
	};
};

function init(All) {
	// TODO use opt.prerender to configure dom plugins
	// TODO expose route for preload and route for load,
	// the route for load will use the preload route as source (view helper can pipe http requests)
	All.app.get('*', All.dom('read').load(prerenderPolyfillImports));
}

/*
* express-dom load plugin that injects html import polyfill
*/
function prerenderPolyfillImports(page, settings) {
	if (!module.htmlImportPolyfill) {
		module.htmlImportPolyfill = require('fs').readFileSync(require.resolve('@webcomponents/html-imports'));
	}
	settings.load.scripts.unshift(module.htmlImportPolyfill);
}
