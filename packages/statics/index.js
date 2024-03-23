const serveStatic = require.lazy('serve-static');
const Path = require('node:path');
const { promises: fs } = require('node:fs');

const bundler = require.lazy('postinstall-esbuild');

module.exports = class StaticsModule {
	static name = 'statics';

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			cache: app.cache.opts,
			uploads: app.upload.opts.dir,
			tmp: app.dirs.tmp,
			statics: Path.join(app.dirs.cache, "statics"),
			files: Path.join(app.dirs.cache, "files"),
			public: Path.join(app.dirs.cache, "public"),
			...opts
		};

		app.dirs.staticsCache = this.opts.statics;
		app.dirs.filesCache = this.opts.files;
		app.dirs.publicCache = this.opts.public;
	}

	fileRoutes(app, server) {
		const { opts } = this;
		const serveOpts = {
			index: false,
			redirect: false,
			dotfiles: 'ignore',
			fallthrough: true
		};

		const filesPrefix = '/.files';
		server.get(filesPrefix + "/*",
			req => {
				const { path, site } = req;
				req.url = site.id + path.substring(filesPrefix.length);
			},
			app.cache.tag('app-:site').for({
				immutable: true,
				maxAge: opts.cache.files
			}),
			serveStatic(opts.files, serveOpts),
			staticNotFound
		);

		const publicPrefix = '/.public';
		server.get(publicPrefix + "/*",
			req => {
				const { path, site } = req;
				req.url = site.id + path.substring(publicPrefix.length);
			},
			app.cache.disable(),
			serveStatic(opts.public, serveOpts),
			staticNotFound
		);

		server.get('/favicon.ico',
			app.cache.tag('data-:site').for({
				immutable: true,
				maxAge: opts.cache.icon
			}),
			({ site }, res, next) => {
				if (!site || !site.data.favicon) {
					res.sendStatus(204);
				} else {
					res.redirect(site.data.favicon + "?format=ico");
				}
			}
		);
	}

	get(req) {
		const { path, site } = req;
		const { uploads, files } = this.opts;
		let pathname;
		if (path.startsWith('/.uploads/')) {
			pathname = Path.join(uploads, site.id, path.substring(9));
		} else if (path.startsWith('/.files/')) {
			pathname = Path.join(files, site.id, path.substring(7));
		}
		return pathname;
	}

	async bundle(site, { inputs, output, dry = false, local = false }) {
		if (inputs.length == 0) return [];
		const suffix = {
			production: ".min",
			staging: ".max",
			dev: ""
		}[site.data.env] || "";
		const { dir } = site.$pkg;
		if (!suffix || !dir || !site.$url) {
			return inputs;
		}

		const fileObj = Path.parse(output);
		const ext = fileObj.ext.substring(1);
		if (ext != "js" && ext != "css") {
			throw new Error("Bundles only .js or .css extensions");
		}
		if (this.opts[ext] == null) {
			throw new Error(`Set statics.${ext} to a browserslist query`);
		}
		delete fileObj.base;
		fileObj.name += suffix;
		const buildFile = Path.format(fileObj);
		const buildDir = Path.join(dir, "builds");
		const buildPath = Path.join(buildDir, buildFile);

		const outList = [];
		const outUrl = `/.files/${site.data.version ?? site.$pkg.tag}/${buildFile}`;
		const outPath = urlToPath(this.opts.files, site.id, outUrl);
		if (local) outList.push(outPath);
		else outList.push(outUrl);

		if (dry) return outList;

		await fs.mkdir(buildDir, { recursive: true });

		if (site.data.version) try {
			// not in branch mode, files are already built, use them
			await fs.stat(buildPath);
			try {
				await fs.stat(outPath);
			} catch (err) {
				await Promise.all([
					fs.copyFile(buildPath, outPath),
					local ? null : fs.copyFile(buildPath + '.map', outPath + '.map').catch(() => { })
				]);
			}
			return outList;
		} catch (err) {
			// pass
		}
		const inList = [];
		inputs.forEach(url => {
			if (local) {
				if (url.startsWith(this.app.dirs.app)) inList.push(url);
				else console.error("file not in project", url);
			} else if (/^https?:\/\//.test(url)) {
				inList.push(url);
			} else {
				inList.push(urlToPath(this.opts.files, site.id, url));
			}
		});

		try {
			await bundler(inList, outPath, {
				minify: site.data.env == "production",
				sourceMap: !local,
				cache: {
					dir: this.opts.statics
				},
				browsers: this.opts[ext]
			});
		} catch(err) {
			delete err.input;
			delete err.source;
			if (err.reason) delete err.message;
			throw err;
		}
		await Promise.all([
			fs.copyFile(outPath, buildPath),
			local ? null : fs.copyFile(outPath + '.map', buildPath + '.map').catch(() => {})
		]);
		return outList;
	}

	async install(site, { directories } = {}) {
		if (!site.$url) return;
		const runSiteDir = Path.join(this.opts.files, site.id);
		await fs.mkdir(runSiteDir, { recursive: true });
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

	async dir(req, { dir, subDir }) {
		const path = Path.join(this.opts[dir], req.site.id, subDir ?? '');
		await fs.mkdir(path, {
			recursive: true
		});
		return path;
	}
	static dir = {
		title: 'Get directory for site',
		$private: true,
		properties: {
			dir: {
				title: 'Directory type',
				enum: ['tmp', 'public']
			},
			subDir: {
				title: 'Optional sub-directory',
				type: 'string',
				format: 'name'
			}
		}
	};
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
