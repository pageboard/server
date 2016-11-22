var serveStatic = require('serve-static');
var serveFavicon = require('serve-favicon');
var Path = require('path');
var pify = require('pify');
var fs = require('fs');
var glob = pify(require('glob'));
var mkdirp = pify(require('mkdirp'));
var fs = pify(fs);
var debug = require('debug')('pageboard-static');

module.exports = function(opt) {
	opt.statics = Object.assign({
		root: 'public',
		mounts: []
	}, opt.statics);
	if (!opt.statics.favicon) {
		opt.statics.favicon = Path.join(opt.statics.root, 'favicon.ico');
	}
	return {file: init};
};

function init(All) {
	var opt = All.opt.statics;
	var app = All.app;

	return fs.stat(opt.favicon).then(function() {
		app.use(serveFavicon(opt.favicon), {
			maxAge: opt.maxAge * 1000
		});
	}).catch(function() {
		app.use('/favicon.ico', function(req, res, next) {
			res.sendStatus(404);
		});
	}).then(function() {
		return Promise.all(opt.mounts.map(function(dir) {
			return mount(opt.root, dir);
		}))
	}).then(function(content) {
		console.info("Serving files in\n", opt.root);
		app.get(/^.*\.\w+/,
			serveStatic(opt.root, {
				maxAge: opt.maxAge * 1000
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
		return fs.lstat(src).catch(function() {}).then(function(stats) {
			if (!stats) return;
			if (stats.isSymbolicLink() == false) {
				return Promise.reject(new Error("Cannot overwrite file with symbolic link:\n" + src));
			} else {
				return fs.unlink(src);
			}
		}).then(function() {
			return fs.symlink(dst, src);
		});
	});
}

