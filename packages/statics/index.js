var serveStatic = require('serve-static');
var serveFavicon = require('serve-favicon');
var Path = require('path');
var pify = require('pify');
var fs = require('fs');
var glob = pify(require('glob'));
var mkdirp = pify(require('mkdirp'));
var fs = pify(fs);
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
	return fs.stat(config.favicon).then(function() {
		app.use(serveFavicon(config.favicon), {
			maxAge: config.statics.maxAge * 1000
		});
	}).catch(function() {
		app.use('/favicon.ico', function(req, res, next) {
			res.sendStatus(404);
		});
	}).then(function() {
		return Promise.all(config.statics.mounts.map(function(dir) {
			return mount(config.statics.root, dir);
		}))
	}).then(function(content) {
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
	return glob('**', {
		cwd: dir,
		nodir: true
	}).then(function(files) {
		debug("found", files);
		return Promise.all(files.map(mountFile.bind(null, root, dir)));
	});
}

function mountFile(root, dir, file) {
	var destDir = Path.dirname(file);
	debug("creating directory", root, destDir);
	return mkdirp(Path.join(root, destDir)).then(function() {
		var src = Path.join(root, file);
		var dst = Path.relative(Path.dirname(src), Path.join(dir, file));
		return fs.unlink(src).catch(function() {}).then(function() {
			return fs.symlink(dst, src);
		});
	});
}

