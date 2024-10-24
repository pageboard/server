const Path = require('node:path');
const { promises: fs } = require('node:fs');

const bundler = require('postinstall-esbuild');

module.exports = class StaticsModule {
	static name = 'statics';

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			...opts,
			bundlerCache: Path.join(app.dirs.cache, "bundler"),
			mounts: {
				share: {
					dir: app.dirs.data,
					owned: false,
					handled: true // handled by image
				},
				image: {
					dir: app.dirs.cache,
					owned: false
				},
				cache: {
					dir: app.dirs.cache,
					owned: true
				},
				site: {
					dir: app.dirs.data,
					owned: true
				},
				tmp: {
					dir: app.dirs.tmp,
					owned: false
				}
			}
		};
	}

	async init() {
		for (const [mount, { dir }] of Object.entries(this.opts.mounts)) {
			await fs.mkdir(Path.join(dir, mount), { recursive: true });
		}
	}

	fileRoutes(router) {
		router.get("/*", this.app.cache.tag('app-:site').for({
			immutable: true,
			maxAge: '1 year'
		}));
		for (const [mount, { handled }] of Object.entries(this.opts.mounts)) {
			if (handled) continue;
			router.get(
				`/${mount}/*`,
				(req, res, next) => {
					const path = this.path(req, req.baseUrl + req.path);
					if (!path) return next(new HttpError.BadRequest("Unknown path"));
					res.accelerate(path);
				}
			);
		}
	}

	path(req, url) {
		const prefix = `/@file/`;
		if (url.startsWith(prefix)) {
			const list = url.substring(prefix.length).split('/');
			const { dir, owned } = this.opts.mounts[list[0]] ?? {};
			if (dir) {
				if (owned) list.splice(1, 0, req.site.id);
				return Path.join(dir, ...list);
			}
		}
	}

	url(req, path) {
		for (const [mount, { dir, owned }] of Object.entries(this.opts.mounts)) {
			if (path.startsWith(Path.join(dir, mount))) {
				const sub = path.substring(dir.length);
				if (owned) {
					const list = sub.split('/');
					list.splice(2, 1);
					return '/@file' + list.join('/');
				} else {
					return '/@file' + sub;
				}
			}
		}
	}

	file(req, { mount, name }) {
		const path = Path.join(this.dir(req, mount), name);
		const url = this.url(req, path);
		return { path, url };
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
		const { version, dir } = site.$pkg;
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
		const sitesDir = this.dir({ site }, 'site');
		const outPath = Path.join(sitesDir, version, buildFile);
		const outUrl = this.url({ site }, outPath);
		if (local) outList.push(outPath);
		else outList.push(outUrl);

		if (dry) return outList;

		await fs.mkdir(buildDir, { recursive: true });

		try {
			// not in branch mode, files are already built, use them
			await fs.stat(buildPath);
			try {
				await fs.stat(outPath);
			} catch {
				await Promise.all([
					fs.copyFile(buildPath, outPath),
					local ? null : fs.copyFile(buildPath + '.map', outPath + '.map').catch(() => { })
				]);
			}
			return outList;
		} catch {
			// pass
		}
		const inList = [];
		inputs.forEach(url => {
			if (force) {
				inList.push(url);
			} else if (local) {
				if (url.startsWith('/@file/site/')) inList.push(url);
				else console.error("file not in project", url);
			} else if (/^https?:\/\//.test(url)) {
				inList.push(url);
			} else if (url.startsWith('/@file/site/')) {
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

	async install({ site }, { directories } = {}) {
		if (!site.$url) return;
		const siteDir = this.dir({ site }, 'site');
		await fs.mkdir(siteDir, { recursive: true });
		if (directories) for (const mount of directories) {
			try {
				await mountDirectory(siteDir, mount.from, this.path({ site }, mount.to));
			} catch (err) {
				console.error("Cannot mount", mount.from, mount.to, err);
			}
		}
	}

	async migrate(req) {
		await req.run('href.change', {
			from: '/.uploads',
			to: '/@file/share'
		});
		await req.run('href.change', {
			from: '/@file',
			to: '/@file/share'
		});
		const dest = this.dir(req, 'share');
		try {
			await fs.cp(
				Path.join(this.app.dirs.data, 'uploads', req.site.id),
				dest,
				{ errorOnExist: true, recursive: true }
			);
		} catch (err) {
			if (err.code != 'ERR_FS_CP_DIR_TO_NON_DIR') throw err;
		}
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
	if (dst.startsWith(base) == false) {
		console.error("Cannot mount outside runtime", dst);
		return;
	}

	Log.statics(`Mount ${src} to ${dst}`);

	await fs.mkdir(Path.dirname(dst), { recursive: true });
	try {
		await fs.unlink(dst);
	} catch {
		// pass
	}
	await fs.symlink(src, dst);
}
