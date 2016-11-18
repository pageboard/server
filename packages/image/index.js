var sharpie = require('sharpie');
var rewrite = require('express-urlrewrite');

exports.file = function(app, api, config) {
	return init;
};

function init(app, api, config) {
	// case when parameter is passed as query.url
	app.get('/media/image', sharpie(config.sharpie));
	app.get('/media/:type/:filename', rewrite('/uploads/:filename'));
}

