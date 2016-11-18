var serveStatic = require('serve-static');
var fs = require('fs');
var glob = require('glob');

exports.file = function(plugins) {
	return init;
};

function init(app, api, config) {
	// list files and directories that are in each statics.mounts
	// create directories, symlink files
	return Promise.all(config.statics.mounts.map(function(dir) {
		return mount(config.statics.root, dir);
	}).next(function() {
		// TODO list root content - for files keep only .*\.ext

	}).next(function(content) {
		app.get(new RegExp("^\/(" + content.join('|') + ")"),
			serveStatic(config.statics.root, {
				maxAge: config.statics.maxAge * 1000
			}),
			function(req, res, next) {
				console.info("File not found", req.path);
				res.sendStatus(404);
			}
		);
	});
}

function mount(root, dir) {
	// return promise
	// glob dir:
	// for each subdir, mkdirp it in root
	// for each file, symlink it

}
