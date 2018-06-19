var serveStatic = require('serve-static');
var URL = require('url');
var Path = require('path');
var pify = require('util').promisify;
var fs = {
	symlink: pify(require('fs').symlink),
	unlink: pify(require('fs').unlink),
	stat: pify(require('fs').stat),
	copyFile: pify(require('fs').copyFile)
};

var mkdirp = pify(require('mkdirp'));
var rimraf = pify(require('rimraf'));

var WorkerNodes = require('worker-nodes');
var workerOpts = {
	minWorkers: 1,
	maxWorkers: 1,
	taskTimeout: 60 * 1000
};
var bundlers = {};

var debug = require('debug')('pageboard:statics');

exports = module.exports = function(opt) {
	if (!opt.statics) opt.statics = {};
	var statics = opt.statics;
	if (!statics.runtime) {
		statics.runtime = Path.join(opt.dirs.runtime, 'statics');
	} else {
		statics.runtime = Path.resolve(statics.runtime);
	}

	statics.nocache = opt.env == "development";
	if (statics.nocache) console.info("Statics cache disabled for development");

	return {
		name: 'statics',
		file: init
	};
};

function init(All) {
	var statics = All.opt.statics;
	var app = All.app;
	bundlers = {
		js: new WorkerNodes(require.resolve('postinstall-js'), workerOpts),
		css: new WorkerNodes(require.resolve('postinstall-css'), workerOpts)
	};
	process.on('exit', function() {
		bundlers.js.terminate();
		bundlers.css.terminate();
	});

	return mkdirp(statics.runtime).then(function() {
		console.info(`Static directories are served from symlinks in ${statics.runtime}`);

		app.get(
			"/:dir(.pageboard|.files|.uploads)/*",
			function(req, res, next) {
				var url = req.url;
				switch(req.params.dir) {
					case ".pageboard":
						req.url = "/" + url.substring(2);
						All.cache.tag('shared').for(statics.nocache ? null : '1 hour')(req, res, next);
						break;
					case ".uploads":
						req.url = "/uploads/" + req.site.id + url.substring(9);
						All.cache.tag('upload').for(statics.nocache ? null : '1 year')(req, res, next);
						break;
					case ".files":
						req.url = "/files/" + req.site.id + url.substring(7);
						All.cache.tag('file').for(statics.nocache ? null : '1 year')(req, res, next);
						break;
				}
				debug("Static url", url, "rewritten to", req.url);
			},
			serveStatic(statics.runtime, {
				index: false,
				redirect: false,
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

		All.app.get('/favicon.ico', function(req, res, next) {
			var site = req.site;
			if (!site || !site.data.favicon) {
				throw new HttpError.NotFound("No favicon");
			} else {
				var path = All.statics.resolve(site.id, site.data.favicon);
				if (!path) throw new HttpError.NotFound("No valid favicon path");
				return All.image.favicon(path).then(function(blob) {
					res.type('image/x-icon');
					res.send(blob);
				});
			}
		});
	});
}

exports.bundle = function(site, pkg, list, filename) {
	if (list.length == 0) return [];
	var installPath = Path.join(pkg.dir, filename);
	var opts = All.opt.statics;
	var version = site.data.version;
	if (version == null) version = 'master';
	var inputs = list.map(function(url) {
		return urlToPath(opts, site.id, url);
	});
	var outUrl = `/.files/${version}/${filename}`;
	var output = urlToPath(opts, site.id, outUrl);

	if (!site.bundles) Object.defineProperty(site, 'bundles', {
		value: {}
	});
	var hash = inputs.join('\n');
	for (var bfn in site.bundles) {
		if (site.bundles[bfn] == hash) {
			return Promise.resolve([bfn]);
		}
	}
	return Promise.resolve().then(function() {
		if (version != '-') return fs.stat(installPath).catch(function(err) {})
		.then(function(stat) {
			return !!stat;
		});
	}).then(function(exists) {
		if (exists) return;
		var ext = Path.extname(filename).substring(1);
		if (ext != "js" && ext != "css") throw new Error("Bundles only .js or .css extensions");
		return bundlers[ext].call(inputs, output, {
			minify: site.data.env == "production",
			builtinClasses: true,
			browsers: opts.browsers
		}).catch(function(err) {
			delete err.input;
			delete err.source;
			if (err.reason) delete err.message;
			throw err;
		}).then(function() {
			return true;
		});
	}).then(function(copyFromRuntime) {
		if (copyFromRuntime) {
			return Promise.all([
				fs.copyFile(output, installPath),
				fs.copyFile(output + '.map', installPath + '.map').catch(function() {})
			]);
		} else {
			return Promise.all([
				fs.copyFile(installPath, output),
				fs.copyFile(installPath + '.map', output + '.map').catch(function() {})
			]);
		}
	}).then(function() {
		site.bundles[outUrl] = hash;
		return [outUrl];
	});
};

function urlToPath(opts, id, url) {
	var obj = URL.parse(url);
	var list = obj.pathname.substring(1).split('/');
	if (list[0].startsWith('.') == false) throw new Error(`Bad ${id} url: ${url}`);
	list[0] = list[0].substring(1);
	if (list[0] != "pageboard") list.splice(1, 0, id);
	return Path.join(opts.runtime, list.join('/'));
}

exports.resolve = function(id, url) {
	return urlToPath(All.opt.statics, id, url);
};

exports.install = function(site, {dir, directories}, All) {
	if (site && !dir) return Promise.resolve(); // nothing to install
	var dir = site ? site.id : null;
	if (dir) dir = Path.join("files", dir);
	else dir = "pageboard";
	var runSiteDir = Path.join(All.opt.statics.runtime, dir);
	return rimraf(runSiteDir).then(function() {
		var p = mkdirp(runSiteDir);
		directories.forEach(function(mount) {
			p = p.then(function() {
				return mountPath(mount.from, mount.to).catch(function(err) {
					console.error("Cannot mount", mount.from, mount.to, err);
					console.error("directories", directories);
				});
			});
		});
		return p;
	});
};

function mountPath(src, dst) {
	var base = All.opt.statics.runtime;
	if (dst.startsWith('/.')) dst = '/' + dst.substring(2);
	var absDst = Path.resolve(Path.join(base, dst));
	if (absDst.startsWith(base) == false) {
		console.error("Cannot mount outside runtime", dst);
		return;
	}

	debug(`Mount ${src} to ${absDst}`);

	return mkdirp(Path.dirname(absDst)).then(function() {
		return fs.unlink(absDst).catch(function(err) {}).then(function() {
			return fs.symlink(src, absDst);
		});
	});
}
