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
	if (!opt.statics) opt.statics = {};
	var statics = opt.statics;
	if (!statics.root) statics.root = Path.join(opt.cwd, 'public');
	if (!statics.runtime) statics.runtime = Path.join(opt.dirs.runtime, 'public');
	if (!statics.mounts) statics.mounts = [];
	if (!statics.favicon) statics.favicon = Path.join(statics.root, 'favicon.ico');
	if (!statics.maxAge) statics.maxAge = 3600;
	if (opt.env == 'development') statics.maxAge = 0;

	return {file: init};
};

function init(All) {
	var statics = All.opt.statics;
	var app = All.app;
	var mounts = [statics.root].concat(statics.mounts);

	return fs.stat(statics.favicon).then(function() {
		app.use(serveFavicon(statics.favicon, {
			maxAge: statics.maxAge * 1000
		}));
	}).catch(function(err) {
		delete statics.favicon;
		app.use('/favicon.ico', function(req, res, next) {
			res.sendStatus(404);
		});
	}).then(function() {
		debug("Static mounts", mounts);
		return mkdirp(statics.runtime).then(function() {
			return Promise.all(mounts.map(function(dir) {
				return mount(statics.runtime, dir);
			}))
		});
	}).then(function(content) {
		var prefix = statics.prefix;
		if (prefix == null) prefix = Path.basename(statics.root);

		console.info("Files mounted on" , prefix, ":\n", statics.root);
		if (statics.runtime != statics.root) console.info("are served from", "\n", statics.runtime);

		app.use(
			'/' + prefix,
			function(req, res, next) {
				if (/^(get|head)$/i.test(req.method)) next();
				else next('route');
			},
			serveStatic(statics.runtime, {
				index: false,
				redirect: false,
				maxAge: statics.maxAge * 1000,
				dotfiles: 'ignore',
				fallthrough: true
			}),
			function(req, res, next) {
				if (/^(get|head)$/i.test(req.method)) {
					next(new HttpError.NotFound("Static file not found"));
				} else {
					next();
				}
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
			p = p.then(mountPath.bind(null, root, dir, paths.shift())).catch(function(err) {
				console.error(err);
			});
		}
		return p;
	});
}

function mountPath(root, dir, path) {
	var dst = Path.join(root, path);
	var src = Path.join(dir, path);

	return Promise.all([
		fs.lstat(src),
		fs.lstat(dst).catch(function(){}).then(function(stat) {
			if (!stat) return stat;
			if (!stat.isSymbolicLink() || stat.isDirectory()) return stat;
			debug("unlink existing file or symlink", dst);
			return fs.unlink(dst).then(function() {
				return stat;
			});
		})
	]).then(function(stats) {
		var srcStat = stats[0];
		var dstStat = stats[1];
		if (srcStat.isSymbolicLink() || srcStat.isFile()) {
			if (dstStat && dstStat.isDirectory()) {
				throw new Error("Cannot deploy a file or symlink over a directory\n" +
					"Please remove manually " + dst);
			} else {
				debug("creating symlink for", src);
				return fs.symlink(src, dst);
			}
		} else if (!dirCache[dst]) {
			debug("create directory", dst);
			dirCache[dst] = true;
			return mkdirp(dst);
		} else {
			debug("already existing directory", dst);
		}
	});
}

