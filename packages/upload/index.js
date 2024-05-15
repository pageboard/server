const { promisify } = require('node:util');
const Path = require('node:path');
const { promises: fs } = require('node:fs');
const randomBytes = promisify(require('node:crypto').pseudoRandomBytes);
const fileUpload = require.lazy('express-fileupload');
const typeis = require.lazy('type-is');
const mime = require.lazy('mime-types');
const speaking = require.lazy('speakingurl');

module.exports = class UploadModule {
	static name = 'upload';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		opts.tmp = app.dirs.tmp;

		opts.limits = {
			files: 10,
			size: 10000000,
			...opts.limits
		};
	}
	async apiRoutes(app, server) {
		app.post('/@api/upload/:id?', async req => {
			const limits = { ...this.opts.limits };
			if (req.params.id) {
				const input = await req.run('block.get', { id: req.params.id });
				if (req.locked(input.lock)) {
					throw new HttpError.Unauthorized("Check user permissions");
				}
				Object.assign(limits, input.data.limits);
			} else {
				console.info("/@api/upload without /:id is deprecated.\nConfigure an upload input and use its id");
			}
			const files = await this.parse(req, limits);
			const list = await Promise.all(files.map(file => this.add(req, file)));
			return { hrefs: list.map(item => item.href) };
		});
	}

	async parse(req, limits) {
		limits = { ...this.limits, ...limits };
		await promisify(fileUpload({
			abortOnLimit: true,
			useTempFiles: true,
			tempFileDir: this.opts.tmp,
			limits: {
				files: limits.files,
				fileSize: limits.size
			}
		}))(req, req.res);
		if (Object.isEmpty(req.files)) {
			throw new HttpError.BadRequest("Missing files");
		}
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
		return entries;
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

	async add(req, data) {
		const subDir = (new Date()).toISOString().split('T').shift().substring(0, 7);
		const dir = Path.join(req.call('statics.dir', '@file'), subDir);
		await fs.mkdir(dir, { recursive: true });
		const parts = data.title.split('.');
		const ext = speaking(parts.pop(), {
			truncate: 8,
			symbols: false
		});
		const basename = speaking(parts.join('-'), {
			truncate: 128,
			symbols: false
		});
		const ranb = (await randomBytes(6)).toString('base64url').replaceAll(/_/g, '');
		const filepath = Path.join(
			dir,
			`${basename}-${ranb}.${ext}`
		);
		await fs.rename(data.path, filepath);
		const image = await req.run('image.add', {
			path: filepath,
			mime: mime.lookup(ext)
		}) ?? { path: filepath };
		const url = this.app.statics.pathToUrl(image.path);
		return req.run('href.add', { url, pathname: url });
	}
	static add = {
		title: 'Add file',
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
};
