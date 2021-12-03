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
	statics.dirs = {
		cache: Path.join(opt.dirs.cache, "statics"),
		files: Path.join(opt.dirs.cache, "files")
	};
	statics.nocache = opt.env == "development";
	if (statics.nocache) console.info("static:\tcache disabled for development");

	return {
		name: 'statics',
		file: init
	};
};

function staticNotFound(req, res, next) {
	if (req.method == "GET" || req.method == "HEAD") {
		next(new HttpError.NotFound("Static file not found"));
	} else {
		next();
	}
}

function init(All) {
	const statics = All.opt.statics;
	const uploads = All.opt.dirs.uploads;
	const app = All.app;
	const serveOpts = {
		index: false,
		redirect: false,
		dotfiles: 'ignore',
		fallthrough: true
	};

	app.get("/.files/*", (req, res, next) => {
		const url = req.url;
		req.url = req.site.id + url.substring(7);
		All.cache.tag('app-:site').for(statics.nocache ? null : '1 year')(req, res, next);
	}, serveStatic(statics.dirs.files, serveOpts), staticNotFound);

	app.get("/.uploads/*", (req, res, next) => {
		const url = req.url;
		req.url = req.site.id + url.substring(9);
		All.cache.for(statics.nocache ? null : '1 year')(req, res, next);
	}, serveStatic(uploads, serveOpts), staticNotFound);

	app.get('/favicon.ico', All.cache.tag('data-:site').for('1 month'), (req, res, next) => {
		const site = req.site;
		if (!site || !site.data.favicon) {
			res.sendStatus(204);
		} else {
			res.redirect(site.data.favicon + "?format=ico");
		}
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
	const buildPath = Path.join(buildDir, filename);
	const dirs = All.opt.statics.dirs;
	let version = site.data.version;
	if (version == null) version = site.branch;
	const outList = [];
	const inputs = [];
	list.forEach((url) => {
		if (/^https?:\/\//.test(url)) outList.push(url);
		else inputs.push(urlToPath(dirs.files, site.id, url));
	});

	const fileObj = Path.parse(filename);
	delete fileObj.base;
	fileObj.name += suffix;

	const outUrl = `/.files/${version}/${Path.format(fileObj)}`;
	outList.push(outUrl);
	const output = urlToPath(dirs.files, site.id, outUrl);

	return Promise.all([
		fs.mkdir(buildDir, {recursive: true}),
		fs.mkdir(dirs.files, {recursive: true})
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
				dir: dirs.cache
			}
		}).catch((err) => {
			delete err.input;
			delete err.source;
			if (err.reason) delete err.message;
			throw err;
		}).then(() => {
			return true;
		});
	}).then((copyFromCache) => {
		if (copyFromCache) {
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

function urlToPath(base, id, url) {
	const obj = URL.parse(url);
	const list = obj.pathname.substring(1).split('/');
	if (list[0].startsWith('.') == false) throw new Error(`Bad ${id} url: ${url}`);
	list[0] = list[0].substring(1);
	list.splice(1, 0, id);
	return Path.join(base, list.slice(1).join('/'));
}

exports.resolve = function (id, url) {
	return urlToPath(All.opt.statics.dirs.files, id, url);
};

exports.install = function(site, {directories}, All) {
	let p = Promise.resolve();
	const dirs = All.opt.statics.dirs;
	if (site) {
		const runSiteDir = Path.join(dirs.files, site.id);
		p = fs.mkdir(runSiteDir, {
			recursive: true
		});
	}
	directories.forEach((mount) => {
		p = p.then(() => {
			return mountPath(dirs.files, mount.from, mount.to).catch((err) => {
				console.error("Cannot mount", mount.from, mount.to, err);
				console.error("directories", directories);
			});
		});
	});
	return p;
};

function mountPath(base, src, dst) {
	if (dst.startsWith('/.')) dst = '/' + dst.substring(2);
	const absDst = Path.resolve(Path.join(base, "..", dst));
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
