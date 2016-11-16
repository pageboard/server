var express = require('express');

exports.route = function(app, api, config) {
	// TODO get the list from the actual directories in public/
	app.get(/^\/(.*\.html|js|components|css|img|themes|uploads|fonts|bundles)/,
		express.static(config.statics.path, {
			maxAge: config.statics.maxAge * 1000
		}),
		function(req, res, next) {
			console.info("File not found", req.path);
			res.sendStatus(404);
		}
	);
};

