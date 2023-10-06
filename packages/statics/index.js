const serveStatic = require.lazy('serve-static');
const Path = require('node:path');
const { promises: fs } = require('node:fs');
const { pipeline } = require('node:stream/promises');

const bundler = require.lazy('postinstall-esbuild');

module.exports = class StaticsModule {
	static name = 'statics';

	constructor(app, opts) {
		this.opts = {
			cache: app.cache.opts,
			uploads: app.upload.opts.dir,
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

		server.get('*', app.cache.tag('remotes'), async (req, res, next) => {
			const host = req.get('X-Proxy-Host');
			if (!host) return next();
			res.vary('X-Proxy-Host');
			const url = new URL(req.url, req.site.url);
			url.port = '';
			url.host = host;
			const headers = Object.fromEntries(
				Object.entries(req.headers).filter(([key]) => !key.startsWith('x-'))
			);
			delete headers.host;
			headers['accept-encoding'] = 'Identity';

			const response = await fetch(url.href, { headers });
			for (const [key, val] of response.headers.entries()) {
				res.set(key, val);
			}
			pipeline(response.body, res);
		});
		const filesPrefix = '/.files';
		server.get(filesPrefix + "/*",
			req => {
				const { path, site } = req;
				req.url = site.id + path.substring(filesPrefix.length);
			},
			app.cache.tag('app-:site').for(opts.cache.files),
			serveStatic(opts.files, serveOpts),
			staticNotFound
		);
		const uploadsPrefix = '/.uploads';
		server.get(uploadsPrefix + "/*",
			req => {
				const { path, site } = req;
				req.url = site.id + path.substring(uploadsPrefix.length);
			},
			// app does not change the files - do not tag
			app.cache.for(opts.cache.uploads),
			serveStatic(opts.uploads, serveOpts),
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
			app.cache.tag('data-:site').for(opts.cache.icon),
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

	async bundle(site, pkg, list, filename, dry = false) {
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
		list.forEach(url => {
			if (/^https?:\/\//.test(url)) outList.push(url);
			else inputs.push(urlToPath(this.opts.files, site.id, url));
		});

		const outUrl = `/.files/${site.data.version ?? site.$pkg.tag}/${buildFile}`;
		outList.push(outUrl);
		const output = urlToPath(this.opts.files, site.id, outUrl);
		if (dry) return outList;

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
			await bundler(inputs, output, {
				minify: site.data.env == "production",
				cache: {
					dir: this.opts.statics
				},
				browsers: this.opts.browsers
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
		if (!site.url) return;
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
