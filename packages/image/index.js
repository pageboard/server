var sharpie = require('sharpie');
var rewrite = require('express-urlrewrite');

module.exports = function(opt) {
	return {file: init};
};

function init(All) {
	// case when parameter is passed as query.url
	All.app.get('/media/image', sharpie(All.opt.sharpie));
	All.app.get('/media/:type/:filename', rewrite('/uploads/:filename'));
}

