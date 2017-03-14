var fs = require('fs');

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
* server prerendering need html import polyfill
*/
var htmlImportPolyfill = fs.readFileSync(require.resolve('@webcomponents/html-imports'));

function prerenderPolyfillImports(page, settings) {
	settings.load.scripts.unshift(htmlImportPolyfill);
}
