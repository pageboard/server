var sharpie = require('sharpie');
var rewrite = require('express-urlrewrite');

module.exports = function(config) {
	return {file: init};
};

function init(app, modules, config) {
	// case when parameter is passed as query.url
	app.get('/media/image', sharpie(config.sharpie));
	app.get('/media/:type/:filename', rewrite('/uploads/:filename'));
}

