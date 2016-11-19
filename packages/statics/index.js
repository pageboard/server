var serveStatic = require('serve-static');
var fs = require('fs');
var Path = require('path');
var glob = require('glob');
var mkdirp = require('mkdirp');
var debug = require('debug')('pageboard-static');

exports.file = function(plugins) {
	return init;
};

function init(app, api, config) {
	// list files and directories that are in each statics.mounts
	// create directories, symlink files
	return Promise.all(config.statics.mounts.map(function(dir) {
		return mount(config.statics.root, dir);
	})).then(function() {
		return new Promise(function(resolve, reject) {
			glob('*', {cwd: config.statics.root}, function(err, paths) {
				if (err) return reject(err);
				debug("files and directories in public/", paths);
				var content = {};
				paths.forEach(function(path) {
					var ext = Path.extname(path);
					if (ext) path = '.*\\' + ext;
					else path = Path.basename(path);
					content[path] = true;
				});
				resolve(Object.keys(content));
			});
		});
	}).then(function(content) {
		console.log("Mounting", content.join(', '), "in", config.statics.root);
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
	debug("Mounting", dir, "in", root);
	return new Promise(function(resolve, reject) {
		debug("globing files in", dir);
		glob('**', {cwd: dir, nodir: true}, function(err, files) {
			debug("found", files);
			if (err) return reject(err);
			return resolve(files);
		});
	}).then(function(files) {
		return Promise.all(files.map(function(file) {
			var destDir = Path.dirname(file);
			return new Promise(function(resolve, reject) {
				debug("creating directory", root, destDir);
				mkdirp(Path.join(root, destDir), function(err) {
					if (err) return reject(err);
					fs.symlink(Path.join(dir, file), Path.join(root, file), function(err) {
						if (err && err.code != 'EEXIST') return reject(err);
						resolve();
					});
				});
			});
		}));
	});
}

