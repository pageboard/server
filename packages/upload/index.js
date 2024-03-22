const fileUpload = require.lazy('express-fileupload');
const Path = require('node:path');
const randomBytes = require('node:util')
	.promisify(require('node:crypto').pseudoRandomBytes);
const typeis = require.lazy('type-is');
const mime = require.lazy('mime-types');
const speaking = require.lazy('speakingurl');
const { promises: fs } = require('node:fs');

module.exports = class UploadModule {
	static name = 'upload';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		console.info("data:", app.dirs.data);
		if (!opts.dir) {
			opts.dir = Path.join(app.dirs.data, "uploads");
		} else {
			console.info(`uploads: ${opts.dir}`);
		}
		app.dirs.uploads = opts.dir;
		opts.tmp = app.dirs.tmp;

		opts.limits = {
			files: 10,
			size: 10000000,
			...opts.limits
		};
	}
	async apiRoutes(app, server) {
		app.post('/.api/upload/:id?', async req => {
			const limits = { ...this.opts.limits };
			if (req.params.id) {
				const input = await req.run('block.get', { id: req.params.id });
				if (req.locked(input.lock)) {
					throw new HttpError.Unauthorized("Check user permissions");
				}
				Object.assign(limits, input.data.limits);
			} else {
				console.warn("/.api/upload without /:id is deprecated.\nConfigure an upload input and use its id");
			}
			const files = await this.parse(req, limits);
			const list = await Promise.all(files.map(file => this.store(req, file)));
			// backward compatibility with elements-write's input href
			const obj = req.params.id ? { items: list } : list;
			return obj;
		});
	}

	parse(req, limits) {
		limits = { ...this.limits, ...limits };
		return new Promise((resolve, reject) => {
			fileUpload({
				abortOnLimit: true,
				useTempFiles: true,
				tempFileDir: this.opts.tmp,
				limits: {
					files: limits.files,
					fileSize: limits.size
				}
			})(req, req.res, err => {
				if (err) {
					if (parseInt(err.status) != err.status) err.status = 400;
					return reject(err);
				}
				if (Object.isEmpty(req.files)) {
					reject(new HttpError.BadRequest("Missing files"));
				} else {
					const types = limits.types?.length ? limits.types : ['*/*'];
					const entries = [];
					for (const [fieldname, file] of Object.entries(req.files)) {
						if (typeis.is(file.mimetype, types)) entries.push({
							name: fieldname,
							title: file.name,
							path: file.tempFilePath,
							mime: file.mimetype,
							size: file.size
						});
					}
					resolve(entries);
				}
			});
		});
	}
	static parse = {
		title: 'Parse request',
		$private: true,
		description: 'Returns a list of { name, title, path, mime, size }',
		properties: {
			files: {
				title: 'Files',
				description: 'Max number of files',
				type: 'integer',
				default: 1
			},
			size: {
				title: 'Size',
				description: 'Max file size in octets',
				type: 'integer',
				nullable: true
			},
			types: {
				title: 'Types',
				description: 'Content type patterns',
				type: 'array',
				items: {
					type: 'string'
				},
				default: ['*/*']
			}
		}
	};

	async store(req, data) {
		// TODO setup pathname here
		/*
	async #dest(req) {
		if (req.site) {
			const date = (new Date()).toISOString().split('T').shift().substring(0, 7);
			const curDest = Path.join(this.opts.dir, req.site.id, date);
			// TODO use req.call('statics.dir', { dir: 'uploads' })
			await fs.mkdir(curDest, { recursive: true });
			return curDest;
		} else {
			return this.opts.tmp;
		}
	}
	async #filename(req, file, cb) {
		const parts = file.originalname.split('.');
		const ext = speaking(parts.pop(), {
			truncate: 8,
			symbols: false
		});
		const basename = speaking(parts.join('-'), {
			truncate: 128,
			symbols: false
		});
		const ranb = await randomBytes(6);
		return `${basename}-${ranb.toString('base64url').replaceAll(/_/g, '')}.${ext}`;
	}
		*/
		const image = await req.run('image.upload', {
			path: data.path,
			mime: mime.lookup(Path.extname(data.path))
		}) ?? data;
		const root = Path.join(this.opts.dir, req.site.id);
		const pathname = Path.join(
			"/.uploads",
			Path.relative(root, image.path)
		);
		await req.run('href.add', { url: pathname });
		return pathname;
	}
	static store = {
		title: 'Store uploaded file',
		$private: true,
		required: ['path'],
		properties: {
			path: {
				title: 'File path',
				type: 'string'
			},
			title: {
				type: 'string',
				nullable: true
			}
		}
	};

	gc(id, pathname) {
		if (!id || !pathname.startsWith('/.uploads')) {
			return Promise.resolve();
		}
		const file = Path.join("uploads", id, pathname);
		return fs.unlink(file).catch(() => {
			// ignore error
		}).then(() => {
			console.info("gc uploaded file", file);
		});
	}

};
