var readFile = require('util').promisify(require('fs').readFile);
var Path = require('path');
var htmlImportPolyfill;

module.exports = function(opt) {
	return {
		view: init
	};
};

function init(All) {
	// TODO use opt.prerender to configure dom plugins
	// TODO expose route for preload and route for load,
	// the route for load will use the preload route as source (view helper can pipe http requests)

	return Promise.all([readFile(Path.join(__dirname, 'read/read.html')).then(function(buf) {
		All.app.get('*', All.dom(buf).load(prerenderPolyfillImports));
	}), readFile(require.resolve('@webcomponents/html-imports')).then(function(buf) {
		htmlImportPolyfill = buf;
	})]);
}

/*
* server prerendering need html import polyfill
*/

function prerenderPolyfillImports(page, settings) {
	settings.load.scripts.unshift(htmlImportPolyfill);
}
