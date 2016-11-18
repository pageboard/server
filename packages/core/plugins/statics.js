var express = require('express');

module.exports = function(plugins) {
	plugins.files.push(init);
};
function init(app, api, config) {
	// TODO
	// symlink config.statics.files to public/
	// add all directories listed in public/
	app.get(/^\/(.*\.html|js|components|css|img|themes|uploads|fonts|bundles)/,
		express.static(config.statics.path, {
			maxAge: config.statics.maxAge * 1000
		}),
		function(req, res, next) {
			console.info("File not found", req.path);
			res.sendStatus(404);
		}
	);
}

