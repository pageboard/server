const Path = require('node:path');
const { promises: fs } = require('node:fs');

const bundler = require.lazy('postinstall-esbuild');

module.exports = class StaticsModule {
	static name = 'statics';

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			...opts,
			bundlerCache: Path.join(app.dirs.cache, "bundler"),
			mounts: {
				'@file': {
					dir: app.dirs.data,
					owned: false,
					age: '1 year'
				},
				'@cache': {
					dir: app.dirs.cache,
					owned: true,
					maxAge: '1 day'
				},
				'@site': {
					dir: app.dirs.data,
					owned: true,
					maxAge: '1 year'
				},
				'@tmp': {
					dir: app.dirs.tmp,
					owned: false,
					maxAge: '1 hour'
				}
			}
		};
	}

	async init() {
		for (const [mount, { dir }] of Object.entries(this.opts.mounts)) {
			await fs.mkdir(Path.join(dir, mount), { recursive: true });
		}
	}

	fileRoutes(app, server) {
		for (const [mount, { dir, owned, maxAge }] of Object.entries(this.opts.mounts)) {
			server.get(`/${mount}/*`,
				app.cache.tag('app-:site').for({
					immutable: true,
					maxAge
				}),
				(req, res, next) => {
					const path = [dir, mount];
					if (owned) path.push(req.site.id);
					path.push(req.path.substring(mount.length + 2));
					res.accelerate(path.join('/'));
				}
			);
		}

		server.get('/favicon.ico',
			app.cache.tag('data-:site').for({
				maxAge: '1 day' // this redirection is subject to change
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

	urlToPath(req, url) {
		for (const [mount, { dir, owned }] of Object.entries(this.opts.mounts)) {
			if (url.startsWith(`/${mount}/`)) {
				if (owned) {
					const list = url.split('/');
					list.splice(2, 0, req.site.id);
					url = list.join('/');
				}
				return Path.join(dir, url);
			}
		}
	}

	pathToUrl(req, path) {
		for (const [mount, { dir, owned }] of Object.entries(this.opts.mounts)) {
			if (path.startsWith(Path.join(dir, mount))) {
				const sub = path.substring(dir.length);
				if (owned) {
					const list = sub.split('/');
					list.splice(2, 1);
					return list.join('/');
				} else {
					return sub;
				}
			}
		}
	}

	dir(req, mount) {
		const def = this.opts.mounts[mount];
		if (!def) throw new HttpError.InternalServerError("No mount for " + mount);
		return Path.join(def.dir, mount, def.owned ? req.site.id : '');
	}

	async bundle(site, { inputs, output, dry = false, local = false, force }) {
		if (inputs.length == 0) return [];
		const suffix = {
			production: ".min",
			staging: ".max",
			dev: ""
		}[site.data.env] || (force ? ".max" : "");
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
		fileObj.base = null;
		fileObj.name += suffix;
		const buildFile = Path.format(fileObj);
		// build dir must be inside the site module directory
		const buildDir = Path.join(dir, "builds");
		const buildPath = Path.join(buildDir, buildFile);

		const outList = [];
		const version = site.data.version ?? site.$pkg.tag;
		const outUrl = `/@site/${version}/${buildFile}`;
		const sitesDir = this.dir({ site }, '@site');
		const outPath = Path.join(sitesDir, version, buildFile);
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
			if (force) {
				inList.push(url);
			} else if (local) {
				if (url.startsWith('/@site/')) inList.push(url);
				else console.error("file not in project", url);
			} else if (/^https?:\/\//.test(url)) {
				inList.push(url);
			} else if (url.startsWith('/@site/')) {
				inList.push(Path.join(sitesDir, url.substring(6)));
			} else {
				console.error("file not in project", url);
			}
		});

		try {
			await bundler(inList, outPath, {
				minify: site.data.env == "production",
				sourceMap: !local,
				cache: {
					dir: this.opts.bundlerCache
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
		const siteDir = this.dir({ site }, '@site');
		await fs.mkdir(siteDir, { recursive: true });
		const baseDir = Path.join(siteDir, "..");
		if (directories) for (const mount of directories) {
			try {
				await mountDirectory(baseDir, mount.from, mount.to);
			} catch (err) {
				console.error("Cannot mount", mount.from, mount.to, err);
			}
		}
	}

	async migrate(req) {
		await req.run('href.change', {
			from: '/.uploads',
			to: '/@file'
		});
		const dest = this.dir(req, '@file');

		await fs.cp(
			Path.join(this.app.dirs.data, 'uploads', req.site.id),
			dest,
			{ errorOnExist: true, recursive: true }
		);
	}
	static migrate = {
		title: 'Migrate from /.uploads to /@file',
		$private: true,
		$global: false,
		$action: 'write',
		$lock: ['webmaster']
	};
};

async function mountDirectory(base, src, dst) {
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
