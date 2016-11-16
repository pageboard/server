var sharpie = require('sharpie');
var rewrite = require('express-urlrewrite');

exports.route = function(app, api, config) {
	// case when parameter is passed as query.url
	app.get('/media/image', sharpie(config.sharpie));
	app.get('/media/:type/:filename', rewrite('/uploads/:filename'));
};

