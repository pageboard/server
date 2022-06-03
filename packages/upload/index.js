const multer = require.lazy('multer');
const Path = require('path');
const randomBytes = require('util').promisify(require('crypto').pseudoRandomBytes);
const typeis = require.lazy('type-is');
const mime = require.lazy('mime-types');
const speaking = require.lazy('speakingurl');
const { promises: fs } = require('fs');

module.exports = class UploadModule {
	static name = 'upload';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		if (!opts.dir) {
			opts.dir = Path.join(app.dirs.data, "uploads");
		}
		app.dirs.uploads = opts.dir;
		opts.tmp = app.dirs.tmp;
		console.info(`uploads:\t${opts.dir}`);
		console.info(`tmp dir:\t${opts.tmp}`);

		opts.limits = {
			files: 100,
			size: 50000000,
			...opts.limits
		};
		this.destination = this.destination.bind(this);
		this.storage = multer.diskStorage(this);
	}
	async apiRoutes(app, server) {
		server.post('/.api/upload/:id?', async req => {
			const limits = { ...this.opts.limits };
			if (req.params.id) {
				const input = await req.run('block.get', { id: req.params.id });
				Object.assign(limits, input.data.limits);
			}
			const files = await this.parse(req, limits);
			const list = await Promise.all(files.map(file => this.store(req, file)));
			// backward compatibility with elements-write's input href
			const obj = req.params.id ? { items: list } : list;
			return obj;
		});
	}
	async destination(req, file, cb) {
		if (req.site) {
			const date = (new Date()).toISOString().split('T').shift().substring(0, 7);
			const curDest = Path.join(this.opts.dir, req.site.id, date);
			await fs.mkdir(curDest, { recursive: true }).then(() => {
				cb(null, curDest);
			}).catch(cb);
		} else {
			cb(null, this.opts.tmp);
		}
	}
	async filename(req, file, cb) {
		const parts = file.originalname.split('.');
		const ext = speaking(parts.pop(), {
			truncate: 8,
			symbols: false
		});
		const basename = speaking(parts.join('-'), {
			truncate: 128,
			symbols: false
		});
		const raw = await randomBytes(4);
		cb(null, `${basename}-${raw.toString('hex')}.${ext}`);
	}
	parse(req, limits) {
		limits = { ...this.limits, ...limits };
		return new Promise((resolve, reject) => {
			multer({
				storage: this.storage,
				fileFilter: function(req, file, cb) {
					const types = limits.types?.length ? limits.types : ['*/*'];
					cb(null, Boolean(typeis.is(file.mimetype, types)));
				},
				limits: {
					files: limits.files,
					fileSize: limits.size
				}
			}).array('files')(req, req.res, err => {
				if (err) return reject(err);
				if (req.files == null) {
					reject(new HttpError.BadRequest("Missing files"));
				} else {
					resolve(req.files.map(file => {
						return {
							name: file.fieldname,
							title: file.originalname,
							path: file.path,
							mime: file.mimetype,
							size: file.size
						};
					}));
				}
			});
		});
	}
	static parse = {
		title: 'Parse request',
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
		const image = await req.run('image.upload', {
			path: data.path,
			mime: mime.lookup(Path.extname(data.path))
		});
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
