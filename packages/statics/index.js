const serveStatic = require.lazy('serve-static');
const URL = require('url');
const Path = require('path');
const fs = require('fs').promises;

const bundlers = {
	js: require.lazy('postinstall-js'),
	css: require.lazy('postinstall-css')
};

exports = module.exports = function(opt) {
	if (!opt.statics) opt.statics = {};
	const statics = opt.statics;
	if (!statics.runtime) {
		statics.runtime = Path.join(opt.dirs.runtime, 'statics');
	} else {
		statics.runtime = Path.resolve(statics.runtime);
	}

	statics.nocache = opt.env == "development";
	if (statics.nocache) console.info("static:\tcache disabled for development");

	return {
		name: 'statics',
		file: init
	};
};

function init(All) {
	const statics = All.opt.statics;
	const app = All.app;

	return fs.mkdir(statics.runtime, {
		recursive: true
	}).then(() => {
		console.info(`static:\tdirectories are served from symlinks in ${statics.runtime}`);

		app.get(
			"/:dir(.files|.uploads)/*",
			(req, res, next) => {
				const url = req.url;
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
				Log.statics("Static url", url, "rewritten to", req.url);
			},
			serveStatic(statics.runtime, {
				index: false,
				redirect: false,
				dotfiles: 'ignore',
				fallthrough: true
			}),
			(req, res, next) => {
				if (req.method == "GET" || req.method == "HEAD") {
					next(new HttpError.NotFound("Static file not found"));
				} else {
					next();
				}
			}
		);

		All.app.get('/favicon.ico', All.cache.tag('data-:site').for('1 month'), (req, res, next) => {
			const site = req.site;
			if (!site || !site.data.favicon) {
				res.sendStatus(204);
			} else {
				res.redirect(site.data.favicon + "?format=ico");
			}
		});
	});
}

exports.bundle = function(site, pkg, list, filename) {
	if (list.length == 0) return [];
	let suffix = site.data.env;
	if (suffix == "production") suffix = ".min";
	else if (suffix == "staging") suffix = ".max";
	else suffix = "";
	if (!suffix || !pkg.dir || !site.href) {
		return Promise.resolve(list);
	}
	const buildDir = Path.join(pkg.dir, "builds");
	const cacheDir = Path.join(All.opt.dirs.cache, "statics");
	const buildPath = Path.join(buildDir, filename);
	const opts = All.opt.statics;
	let version = site.data.version;
	if (version == null) version = site.branch;
	const outList = [];
	const inputs = [];
	list.forEach((url) => {
		if (/^https?:\/\//.test(url)) outList.push(url);
		else inputs.push(urlToPath(opts, site.id, url));
	});

	const fileObj = Path.parse(filename);
	delete fileObj.base;
	fileObj.name += suffix;

	const outUrl = `/.files/${version}/${Path.format(fileObj)}`;
	outList.push(outUrl);
	const output = urlToPath(opts, site.id, outUrl);

	return Promise.all([
		fs.mkdir(buildDir, {recursive: true}),
		fs.mkdir(cacheDir, {recursive: true})
	]).then(() => {
		if (version != site.branch) return fs.stat(buildPath).catch((err) => {})
			.then((stat) => {
				return Boolean(stat);
			});
	}).then((exists) => {
		if (exists) return;
		const ext = fileObj.ext.substring(1);
		if (ext != "js" && ext != "css") throw new Error("Bundles only .js or .css extensions");
		return bundlers[ext](inputs, output, {
			minify: site.data.env == "production",
			cache: {
				dir: cacheDir
			}
		}).catch((err) => {
			delete err.input;
			delete err.source;
			if (err.reason) delete err.message;
			throw err;
		}).then(() => {
			return true;
		});
	}).then((copyFromRuntime) => {
		if (copyFromRuntime) {
			return Promise.all([
				fs.copyFile(output, buildPath),
				fs.copyFile(output + '.map', buildPath + '.map').catch(() => {})
			]);
		} else {
			return Promise.all([
				fs.copyFile(buildPath, output),
				fs.copyFile(buildPath + '.map', output + '.map').catch(() => {})
			]);
		}
	}).then(() => {
		return outList;
	});
};

function urlToPath(opts, id, url) {
	const obj = URL.parse(url);
	const list = obj.pathname.substring(1).split('/');
	if (list[0].startsWith('.') == false) throw new Error(`Bad ${id} url: ${url}`);
	list[0] = list[0].substring(1);
	list.splice(1, 0, id);
	return Path.join(opts.runtime, list.join('/'));
}

exports.resolve = function(id, url) {
	return urlToPath(All.opt.statics, id, url);
};

exports.install = function(site, {directories}, All) {
	let p = Promise.resolve();
	if (site) {
		const dir = Path.join("files", site.id);
		const runSiteDir = Path.join(All.opt.statics.runtime, dir);
		p = fs.mkdir(runSiteDir, {
			recursive: true
		});
	}
	directories.forEach((mount) => {
		p = p.then(() => {
			return mountPath(mount.from, mount.to).catch((err) => {
				console.error("Cannot mount", mount.from, mount.to, err);
				console.error("directories", directories);
			});
		});
	});
	return p;
};

function mountPath(src, dst) {
	const base = All.opt.statics.runtime;
	if (dst.startsWith('/.')) dst = '/' + dst.substring(2);
	const absDst = Path.resolve(Path.join(base, dst));
	if (absDst.startsWith(base) == false) {
		console.error("Cannot mount outside runtime", dst);
		return;
	}

	Log.statics(`Mount ${src} to ${absDst}`);

	return fs.mkdir(Path.dirname(absDst), {
		recursive: true
	}).then(() => {
		return fs.unlink(absDst).catch((err) => {}).then(() => {
			return fs.symlink(src, absDst);
		});
	});
}
