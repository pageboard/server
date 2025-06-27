const Path = require('node:path');
const { promises: fs, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Deferred } = require('class-deferred');

const busboy = require.lazy('busboy');
const mime = require.lazy('mime-types');
const speaking = require.lazy('speakingurl');

const utils = require('../../src/utils');

module.exports = class UploadModule {
	static name = 'upload';
	static $global = true;

	constructor(app, opts) {
		global.AllHrefs = new Map();
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
	async apiRoutes(router) {
		router.write('/upload/add', async req => {
			const hrefs = await this.parse(req);
			return { hrefs };
		});
		router.write('/upload/:id', async req => {
			// everything here is deprecated
			const limits = { ...this.opts.limits };
			const input = await req.run('block.get', { id: req.params.id });
			if (req.locked(input.lock)) {
				throw new HttpError.Unauthorized("Check user permissions");
			}
			Object.assign(limits, input.data.limits);
			const hrefs = await this.parse(req);
			return { hrefs };
		});
	}

	#acceptable(req) {
		const { headers } = req;
		return (
			'transfer-encoding' in headers || 'content-length' in headers && headers['content-length'] !== '0'
		) && headers['content-type']?.startsWith('multipart/form-data');
	}

	async save(req, { stream, filename }) {
		const pathObj = Path.parse(filename);
		const ext = pathObj.ext.toLowerCase();
		if (/^\.[a-z]{3,4}$/.test(ext) == false) {
			// unsupported file extension format
			stream.resume();
			throw new HttpError.BadRequest("Unsupported file extension: " + ext);
		}
		const subDir = (new Date()).toISOString().split('T').shift().substring(0, 7);
		const dir = Path.join(req.call('statics.dir', 'share'), subDir);
		await fs.mkdir(dir, { recursive: true });

		const basename = speaking(pathObj.name, {
			truncate: 128,
			symbols: false
		});
		const ranb = utils.hash(Date.now().toString());
		const filePath = Path.join(dir, `${basename}-${ranb}${ext}`);
		try {
			await pipeline(
				stream,
				createWriteStream(filePath)
			);
			const image = await req.run('image.add', {
				path: filePath,
				mime: mime.lookup(ext)
			}) ?? { path: filePath };
			const url = req.call('statics.url', image.path);
			return req.run('href.add', { url, pathname: url });
		} catch (err) {
			console.error(err);
			try {
				await fs.unlink(filePath);
			} catch {
				// always cleanup
			}
			throw err;
		}
	}

	async parse(req, options) {
		if (!this.#acceptable(req)) return [];
		const bb = busboy({
			headers: req.headers,
			limits: this.opts.limits
		});
		if (!req.body || req.body instanceof Buffer) {
			req.body = Object.create(null);
		}
		const ret = Promise.withResolvers();
		const defers = [];

		bb.on('file', async (name, stream, { filename, encoding }) => {
			const d = Promise.withResolvers();
			defers.push(d.promise);
			try {
				const { href } = await this.save(req, { stream, filename });
				this.#fill(req.body, name, href.url);
				global.AllHrefs.set(href.url, href);
				d.resolve(href);
			} catch (err) {
				d.reject(err);
			}
		});

		bb.on('field', (name, value) => this.#fill(req.body, name, value));

		bb.on('close', async () => {
			try {
				ret.resolve(await Promise.all(defers));
			} catch (err) {
				ret.reject(err);
			}
		});
		req.pipe(bb);
		return ret.promise;
	}

	static parse = {
		title: 'Parse multipart/form-data',
		$private: true
	};

	files(req, { files, size, types }) {
		// TODO
		// on voudrait pouvoir passer des chemins depuis la commande en ligne
		// mais pas depuis l'application (trou de sécurité)
		// il faut une option pour la commande en ligne qui permet d'envoyer
		// des paramètres en mode "multipart/form-data"
		// et préciser quels paramètres sont des fichiers locaux:
		// --data.files=@path.txt le @ précise qu'il faut charger le fichier
		const hrefs = [];
		for (const file of files) {
			const href = global.AllHrefs.get(file);
			if (!href) {
				throw new HttpError.BadRequest("Unknown file: " + file);
			}
			hrefs.push(href);
			if (href.size > size) {
				throw new HttpError.BadRequest("File size too big > " + size);
			}
			if (types?.length > 0) {
				const [ctype, csub] = href.mime.split('/');
				if (!types.some(pat => {
					const [type, sub] = pat.split('/');
					return (type == "*" || type == ctype) && (sub == "*" || sub == csub);
				})) {
					throw new HttpError.BadRequest("File type not allowed by " + types.join(', '));
				}
			}
		}
		return { hrefs };
	}

	static files = {
		title: 'Files',
		$action: 'write',
		properties: {
			files: {
				title: 'Files',
				type: 'array',
				items: {
					type: 'string',
					format: 'pathname',
					$file: {}
				}
			},
			size: {
				title: 'Max size in bytes',
				type: 'integer',
				minimum: 0,
				nullable: true
			},
			types: {
				title: 'Allowed mime types',
				type: 'array',
				items: {
					type: 'string',
					pattern: /^([a-z]+|\*)\/([a-z]+|\*)$/.source
				},
				nullable: true
			}
		}
	};

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
};
