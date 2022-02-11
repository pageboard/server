const multer = require.lazy('multer');
const Path = require('path');
const randomBytes = require('util').promisify(require('crypto').pseudoRandomBytes);
const typeis = require('type-is');
const mime = require.lazy('mime-types');
const speaking = require.lazy('speakingurl');
const fs = require('fs').promises;

module.exports = class UploadModule {
	static name = 'upload';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		if (!opts.dir) {
			opts.dir = Path.join(app.dirs.data, "uploads");
		}
		opts.tmp = app.dirs.tmp;
		console.info(`uploads:\t${opts.dir}`);
		console.info(`tmp dir:\t${opts.tmp}`);

		opts.limits = Object.assign({
			files: 100,
			size: 50000000
		}, opts.limits);

		this.store = multer.diskStorage(this);
	}
	async init() {
		return fs.mkdir(this.opts.dir, { recursive: true });
	}
	async service(server) {
		server.post('/.api/upload/:id?', async (req) => {
			const limits = Object.assign({}, this.opts.limits);
			if (req.params.id) {
				const input = await this.app.run('block.get', req, { id: req.params.id });
				Object.assign(limits, input.data.limits);
			}
			const files = await this.parse(req, limits);
			const list = await Promise.all(files.map((file) => {
				return this.file(req, file);
			}));
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
	filename(req, file, cb) {
		const parts = file.originalname.split('.');
		const ext = speaking(parts.pop(), {
			truncate: 8,
			symbols: false
		});
		const basename = speaking(parts.join('-'), {
			truncate: 128,
			symbols: false
		});
		return randomBytes(4).then(raw => `${basename}-${raw.toString('hex')}.${ext}`);
	}
	parse(req, limits) {
		limits = Object.assign({}, this.limits, limits);
		return new Promise((resolve, reject) => {
			multer({
				storage: this.store,
				fileFilter: function(req, file, cb) {
					const types = limits.types.length ? limits.types : ['*/*'];
					cb(null, Boolean(typeis.is(file.mimetype, types)));
				},
				limits: {
					files: limits.files,
					fileSize: limits.size
				}
			}).array('files')(req, null, (err, req, res, next) => {
				if (err) {
					reject(err);
				}
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

	async file(req, data) {
		const image = await this.app.run('image.upload', req, {
			path: data.path,
			mime: mime.lookup(Path.extname(data.path))
		});
		const root = Path.join(this.opts.dir, req.site.id);
		const pathname = Path.join(
			"/.uploads",
			Path.relative(root, image.path)
		);
		await this.app.run('href.add', req, { url: pathname });
		return pathname;
	}
	static file = {
		title: 'Upload file',
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
