var serveStatic = require('serve-static');
var serveFavicon = require('serve-favicon');
var fs = require('fs');
var Path = require('path');
var glob = require('glob');
var mkdirp = require('mkdirp');
var debug = require('debug')('pageboard-static');

module.exports = function(config) {
	config.statics = Object.assign({
		root: 'public',
		mounts: []
	}, config.statics);
	if (!config.favicon) config.favicon = Path.join(config.statics.root, 'favicon.ico');
	return {file: init};
};

function init(app, modules, config) {
	fs.stat(config.favicon, function(err) {
		if (err) app.use('/favicon.ico', function(req, res, next) {
			res.sendStatus(404);
		});
		else app.use(serveFavicon(config.favicon), {
			maxAge: config.statics.maxAge * 1000
		});
	});
	// list files and directories that are in each statics.mounts
	// create directories, symlink files
	return Promise.all(config.statics.mounts.map(function(dir) {
		return mount(config.statics.root, dir);
	})).then(function(content) {
		console.info("Serving files in\n", config.statics.root);
		app.get(/^.*\.\w+/,
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
					var src = Path.join(root, file);
					fs.symlink(Path.relative(Path.dirname(src), Path.join(dir, file)), src, function(err) {
						if (err) {
							if (err.code == 'EEXIST') {
								return fs.lstat(src, function(err, stats) {
									if (stats.isSymbolicLink()) resolve();
									else reject(err);
								});
							} else {
								return reject(err);
							}
						}
						resolve();
					});
				});
			});
		}));
	});
}

