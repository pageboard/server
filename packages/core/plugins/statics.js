var express = require('express');

exports.file = function(plugins) {
	return init;
};

function init(app, api, config) {
	// list files and directories that are in each statics.mounts
	// create directories, symlink files
	//

	app.get(/^\/(.*\.html|js|components|css|img|themes|uploads|fonts|bundles)/,
		express.static(config.statics.root, {
			maxAge: config.statics.maxAge * 1000
		}),
		function(req, res, next) {
			console.info("File not found", req.path);
			res.sendStatus(404);
		}
	);
}

