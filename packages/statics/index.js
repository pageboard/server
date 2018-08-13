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
			"/:dir(.files|.uploads)/*",
			function(req, res, next) {
				var url = req.url;
				switch(req.params.dir) {
					case ".uploads":
						req.url = "/uploads/" + req.site.id + url.substring(9);
						All.cache.for(statics.nocache ? null : '1 year')(req, res, next);
						break;
					case ".files":
						req.url = "/files/" + req.site.id + url.substring(7);
						All.cache.tag('app-:site').for(statics.nocache ? null : '1 year')(req, res, next);
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
				next(new HttpError.NotFound("No favicon"));
			} else {
				res.redirect(site.data.favicon + "?format=ico");
			}
		});
	});
}

exports.bundle = function(site, pkg, list, filename) {
	if (list.length == 0) return [];
	var buildDir = Path.join(pkg.dir, "builds");
	var buildPath = Path.join(buildDir, filename);
	var opts = All.opt.statics;
	var version = site.data.version;
	if (version == null) version = 'master';
	var inputs = list.map(function(url) {
		return urlToPath(opts, site.id, url);
	});
	var outUrl = `/.files/${version}/${filename}`;
	var output = urlToPath(opts, site.id, outUrl);

	if (!site.$bundles) site.$bundles = {};
	var hash = inputs.join('\n');
	for (var bfn in site.$bundles) {
		if (site.$bundles[bfn].hash == hash) {
			return site.$bundles[bfn].promise;
		}
	}
	var p = mkdirp(buildDir).then(function() {
		if (version != 'master') return fs.stat(buildPath).catch(function(err) {})
		.then(function(stat) {
			return !!stat;
		});
	}).then(function(exists) {
		if (exists) return;
		var ext = Path.extname(filename).substring(1);
		if (ext != "js" && ext != "css") throw new Error("Bundles only .js or .css extensions");
		return bundlers[ext].call(inputs, output, {
			minify: site.data.env != "dev",
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
				fs.copyFile(output, buildPath),
				fs.copyFile(output + '.map', buildPath + '.map').catch(function() {})
			]);
		} else {
			return Promise.all([
				fs.copyFile(buildPath, output),
				fs.copyFile(buildPath + '.map', output + '.map').catch(function() {})
			]);
		}
	}).then(function() {
		return [outUrl];
	});
	site.$bundles[outUrl] = {
		hash: hash,
		promise: p
	};
	return p;
};

function urlToPath(opts, id, url) {
	var obj = URL.parse(url);
	var list = obj.pathname.substring(1).split('/');
	if (list[0].startsWith('.') == false) throw new Error(`Bad ${id} url: ${url}`);
	list[0] = list[0].substring(1);
	list.splice(1, 0, id);
	return Path.join(opts.runtime, list.join('/'));
}

exports.resolve = function(id, url) {
	return urlToPath(All.opt.statics, id, url);
};

exports.install = function(site, {directories}, All) {
	var p = Promise.resolve();
	if (site) {
		var dir = Path.join("files", site.id);
		var runSiteDir = Path.join(All.opt.statics.runtime, dir);
		p = mkdirp(runSiteDir);
	}
	directories.forEach(function(mount) {
		p = p.then(function() {
			return mountPath(mount.from, mount.to).catch(function(err) {
				console.error("Cannot mount", mount.from, mount.to, err);
				console.error("directories", directories);
			});
		});
	});
	return p;
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
