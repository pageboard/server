var serveStatic = require('serve-static');
var serveFavicon = require('serve-favicon');
var Path = require('path');
var pify = require('pify');
var fs = pify(require('fs'), ['stat', 'lstat', 'symlink', 'unlink']);

var glob = pify(require('glob'));
var mkdirp = pify(require('mkdirp'));
var debug = require('debug')('pageboard-static');

var dirCache = {};

module.exports = function(opt) {
	opt.statics = Object.assign({
		root: process.cwd() + '/public',
		runtime: Path.join(opt.dirs.runtime, 'public'),
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
			return mount(opt.runtime, dir);
		}))
	}).then(function(content) {
		var prefix = opt.prefix;
		if (prefix == null) prefix = Path.basename(opt.root);

		console.info("Files mounted on" , prefix, ":\n", opt.root);
		if (opt.runtime != opt.root) console.info("are served from", "\n", opt.runtime);

		app.use(
			'/' + prefix,
			serveStatic(opt.runtime, {
				index: false,
				redirect: false,
				maxAge: opt.maxAge * 1000
			}),
			function(req, res, next) {
				next(new HttpError.NotFound("Static file not found"));
			}
		);
	});
}

function mount(root, dir) {
	debug("Mounting", dir, "in", root);
	return glob('**', {
		cwd: dir
	}).then(function(paths) {
		var p = Promise.resolve();
		while (paths.length) {
			p = p.then(mountPath.bind(null, root, dir, paths.shift()));
		}
		return p;
	});
}

function mountPath(root, dir, path) {
	var dst = Path.join(root, path);
	// var src = Path.relative(Path.dirname(dst), Path.join(dir, path));
	var src = Path.join(dir, path);
	// if src is symlink or file, symlink it, if it's a directory, create a dir
	return fs.lstat(src).then(function(stats) {
		if (!stats) return;
		if (stats.isSymbolicLink() || stats.isFile()) {
			return fs.lstat(dst).catch(function(){}).then(function(lstats) {
				if (!lstats) return;
				if (lstats.isSymbolicLink()) {
					debug("unlink existing symlink", dst);
					return fs.unlink(dst);
				} else {
					throw new Error("A file or directory already exists :\n" + dst);
				}
			}).then(function() {
				debug("creating symlink for", src);
				return fs.symlink(src, dst);
			});
		} else if (!dirCache[dst]) {
			debug("create directory", dst);
			dirCache[dst] = true;
			return mkdirp(dst);
		}
	});
}

