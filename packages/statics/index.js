const serveStatic = require.lazy('serve-static');
const Path = require('path');
const { promises: fs } = require('fs');

const bundlers = {
	js: require.lazy('postinstall-js'),
	css: require.lazy('postinstall-css')
};

module.exports = class StaticsModule {
	static name = 'statics';

	constructor(app, opts) {
		this.opts = {
			cache: Path.join(app.dirs.cache, "statics"),
			files: Path.join(app.dirs.cache, "files"),
			nocache: app.env == "development",
			...opts
		};
		app.dirs.staticsCache = this.opts.cache;
		app.dirs.staticsFiles = this.opts.files;

		if (this.opts.nocache) {
			console.info("static:\tcache disabled for development");
		}
	}

	fileRoutes(app, server) {
		const { opts } = this;
		const serveOpts = {
			index: false,
			redirect: false,
			dotfiles: 'ignore',
			fallthrough: true
		};

		server.get("/.files/*",
			req => {
				const { url, site } = req;
				req.url = site.id + url.substring(7);
			},
			app.cache.tag('app-:site').for(opts.nocache ? null : '1 year'),
			serveStatic(opts.files, serveOpts),
			staticNotFound
		);

		server.get("/.uploads/*",
			req => {
				const { url, site } = req;
				req.url = site.id + url.substring(9);
			},
			app.cache.for(opts.nocache ? null : '1 year'),
			serveStatic(app.upload.opts.dir, serveOpts),
			staticNotFound
		);

		server.get('/favicon.ico',
			app.cache.tag('data-:site').for(opts.nocache ? null : '1 month'),
			({ site }, res, next) => {
				if (!site || !site.data.favicon) {
					res.sendStatus(204);
				} else {
					res.redirect(site.data.favicon + "?format=ico");
				}
			}
		);
	}

	async bundle(site, pkg, list, filename) {
		if (list.length == 0) return [];
		const suffix = {
			production: ".min",
			staging: ".max",
			dev: ""
		}[site.data.env] || "";
		if (!suffix || !pkg.dir || !site.url) {
			return list;
		}

		const fileObj = Path.parse(filename);
		const ext = fileObj.ext.substring(1);
		if (ext != "js" && ext != "css") {
			throw new Error("Bundles only .js or .css extensions");
		}
		delete fileObj.base;
		fileObj.name += suffix;
		const buildFile = Path.format(fileObj);
		const buildDir = Path.join(pkg.dir, "builds");
		const buildPath = Path.join(buildDir, buildFile);

		const outList = [];
		const inputs = [];
		list.forEach((url) => {
			if (/^https?:\/\//.test(url)) outList.push(url);
			else inputs.push(urlToPath(this.opts.files, site.id, url));
		});

		const outUrl = `/.files/${site.data.version ?? site.$pkg.tag}/${buildFile}`;
		outList.push(outUrl);
		const output = urlToPath(this.opts.files, site.id, outUrl);

		await fs.mkdir(buildDir, { recursive: true });

		if (site.data.version) try {
			// not in branch mode, files are already built, use them
			await fs.stat(buildPath);
			await Promise.all([
				fs.copyFile(buildPath, output),
				fs.copyFile(buildPath + '.map', output + '.map').catch(() => {})
			]);
			return outList;
		} catch (err) {
			// pass
		}

		try {
			await bundlers[ext](inputs, output, {
				minify: site.data.env == "production",
				cache: {
					dir: this.opts.cache
				}
			});
		} catch(err) {
			delete err.input;
			delete err.source;
			if (err.reason) delete err.message;
			throw err;
		}
		await Promise.all([
			fs.copyFile(output, buildPath),
			fs.copyFile(output + '.map', buildPath + '.map').catch(() => {})
		]);
		return outList;
	}

	async install(site, { directories } = {}) {
		if (site) {
			const runSiteDir = Path.join(this.opts.files, site.id);
			await fs.mkdir(runSiteDir, { recursive: true });
		}
		if (directories) for (const mount of directories) {
			try {
				await mountPath(this.opts.files, mount.from, mount.to);
			} catch (err) {
				console.error("Cannot mount", mount.from, mount.to, err);
			}
		}
	}

	resolve(id, url) {
		return urlToPath(this.opts.files, id, url);
	}
};

function staticNotFound(req) {
	if (req.method == "GET" || req.method == "HEAD") {
		throw new HttpError.NotFound("Static file not found");
	}
}

function urlToPath(base, id, url) {
	const obj = new URL(url, "http://-");
	const list = obj.pathname.substring(1).split('/');
	if (list[0].startsWith('.') == false) throw new Error(`Bad ${id} url: ${url}`);
	list[0] = list[0].substring(1);
	list.splice(1, 0, id);
	return Path.join(base, list.slice(1).join('/'));
}

async function mountPath(base, src, dst) {
	if (dst.startsWith('/.')) dst = '/' + dst.substring(2);
	const absDst = Path.resolve(Path.join(base, "..", dst));
	if (absDst.startsWith(base) == false) {
		console.error("Cannot mount outside runtime", dst);
		return;
	}

	Log.statics(`Mount ${src} to ${absDst}`);

	await fs.mkdir(Path.dirname(absDst), { recursive: true });
	try {
		await fs.unlink(absDst);
	} catch (err) {
		// pass
	}
	return fs.symlink(src, absDst);
}
