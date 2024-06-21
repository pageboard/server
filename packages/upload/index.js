const { promisify } = require('node:util');
const Path = require('node:path');
const { promises: fs, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const randomBytes = promisify(require('node:crypto').pseudoRandomBytes);
const busboy = require.lazy('busboy');
const mime = require.lazy('mime-types');
const speaking = require.lazy('speakingurl');
const { Deferred } = require.lazy('class-deferred');
const LimitStream = require.lazy('./src/limit.js');

module.exports = class UploadModule {
	static name = 'upload';

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		opts.tmp = app.dirs.tmp;
		opts.limits = {
			fields: 1000,
			files: 20,
			headerPairs: 100,
			fieldSize: 128000,
			defaultFileSize: 10000000,
			...opts.limits
		};
	}
	async apiRoutes(app, server) {
		app.post('/@api/upload/:id?', async req => {
			// everything here is deprecated
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
			const hrefs = await this.parser(req, { '*': limits });
			return { hrefs };
		});
	}

	async parser(req, opts) {
		const bb = busboy({
			headers: req.headers,
			limits: this.opts.limits
		});
		if (!req.body || req.body instanceof Buffer) {
			req.body = Object.create(null);
		}
		const hrefs = []; // for old api
		bb.on('file', async (name, stream, { filename, encoding, mimeType }) => {
			const limits = opts[name] ?? opts['*'];
			if (!limits) {
				// ignore
				stream.resume();
				return;
			}
			const type = req.accepts.call({
				headers: {
					accept: (limits.types ?? ["*/*"]).join(", ")
				}
			}, [mimeType]);
			if (!type) {
				stream.resume();
				return;
			}
			const ext = mime.extension(type);
			const subDir = (new Date()).toISOString().split('T').shift().substring(0, 7);
			const dir = Path.join(req.call('statics.dir', '@file'), subDir);
			await fs.mkdir(dir, { recursive: true });

			const basename = speaking(Path.parse(filename).name, {
				truncate: 128,
				symbols: false
			});
			const ranb = (await randomBytes(6)).toString('base64url')
				.replaceAll(/[_-]/g, 'x');
			const filePath = Path.join(dir, `${basename}-${ranb}.${ext}`);
			try {
				await pipeline(
					stream,
					new LimitStream(limits.size ?? this.opts.limits.defaultFileSize),
					createWriteStream(filePath)
				);
				const image = await req.run('image.add', {
					path: filePath,
					mime: mimeType
				}) ?? { path: filePath };
				const url = this.app.statics.pathToUrl(image.path);
				const href = await req.run('href.add', { url, pathname: url });
				this.#fill(req.body, name, url);
				hrefs.push(href);
			} catch (err) {
				console.error(err);
				try {
					await fs.unlink(filePath);
				} catch {
					// always cleanup
				}
			}
		});
		bb.on('field', (name, value) => this.#fill(req.body, name, value));
		const d = new Deferred();
		bb.on('close', () => {
			d.resolve(hrefs);
		});
		req.pipe(bb);
		return d;
	}

	#fill(body, name, value) {
		if (value == null) return;
		const prev = body[name];
		if (prev) {
			if (Array.isArray(prev)) prev.push(value);
			else body[name] = [prev, value];
		} else {
			body[name] = value;
		}
	}

	static parser = {
		title: 'Parse body',
		description: 'return hrefs for compatibility with old api',
		$private: true,
		properties: {},
		additionalProperties: {
			type: 'object',
			properties: {
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
		}
	};
};
