var readFile = require('util').promisify(require('fs').readFile);
var Path = require('path');

module.exports = function(opt) {
	return {
		priority: 0,
		view: init
	};
};

function init(All) {
	// TODO use opt.prerender to configure dom plugins
	// TODO expose route for preload and route for load,
	// the route for load will use the preload route as source (view helper can pipe http requests)

	return readFile(Path.join(__dirname, 'read/read.html')).then(function(buf) {
		All.app.get('*', All.cache.tag('api', 'share', 'file'), All.dom(buf).load());
	});
}

