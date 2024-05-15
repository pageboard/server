const {
	promises: fs,
	createReadStream,
	createWriteStream
} = require('node:fs');
const { pipeline } = require('node:stream/promises');
const Path = require('node:path');
const { glob } = require.lazy('glob');

const DatauriParser = require.lazy('datauri/parser');
const allowedParameters = {
	rs: true,
	ex: true,
	q: true,
	format: true,
	fg: true,
	bg: true
};

module.exports = class ImageModule {
	static name = 'image';
	static priority = -1;
	static $global = true;
	static sizes = {
		xs: {
			title: 'Extra Small',
			width: 200,
			height: 200
		},
		s: {
			title: 'Small',
			width: 400,
			height: 400
		},
		m: {
			title: 'Medium',
			width: 800,
			height: 800
		},
		l: {
			title: 'Large',
			width: 1600,
			height: 1600
		},
		xl: {
			title: 'Extra Large',
			width: 3200, // A4 pages
			height: 3200
		}
	};

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			async param(req, { rs }) {
				const size = req.call('image.guess', {
					width: rs?.w ?? 0,
					height: rs?.h ?? 0,
					fit: rs.fit
				});
				return req.call('image.get', {
					url: req.path,
					size
				});
			},
			dir: '.image',
			signs: {
				assignment: '-',
				separator: '_'
			},
			...opts
		};
	}

	async init() {
		const { sharp, sharpie, Sharpie } = await import('sharpie');
		this.sharp = sharp;
		this.sharpie = sharpie;
		this.fileTypes = Sharpie.fileTypes;
	}

	mw(req, res, next) {
		const extname = Path.extname(req.path);
		if (!extname || /png|jpe?g|gif|webp|tiff|svg/.test(extname.substring(1)) == false) {
			return next('route');
		}
		const wrongParams = [];
		Object.keys(req.query).some(key => {
			if (!allowedParameters[key]) wrongParams.push(key);
		});
		if (wrongParams.length) {
			Log.image("wrong image params", req.url, wrongParams);
			res.sendStatus(400);
		} else {
			Log.image(req.url);
			next();
		}
	}

	fileRoutes(app, server) {
		server.get(
			/^\/@file\//,
			this.mw,
			// files are loaded directly and need some headers
			app.cache.for({
				immutable: true,
				maxAge: '1 year'
			}),
			this.sharpie(this.opts)
		);
	}

	async resize(req, { input, output, format, width, height, enlarge, background }) {
		const formatOpts = {
			quality: format.quality
		};
		if (format.name == "webp") {
			formatOpts.reductionEffort = 3;
			if (format.lossless == "yes") {
				formatOpts.lossless = true;
			} else if (format.lossless == "near") {
				formatOpts.nearLossless = true;
			} else if (!format.lossless) {
				formatOpts.lossless = false;
				formatOpts.smartSubsample = true;
			}
		}

		const ret = {
			mime: this.fileTypes[format.name],
			path: output
		};

		const transform = this.sharp()
			.rotate()
			.resize({
				fit: "inside",
				withoutEnlargement: !enlarge,
				fastShrinkOnLoad: true,
				width,
				height
			})
			.toFormat(format.name, formatOpts);
		if (background) {
			transform.flatten({
				background
			});
		}
		let inputStream;
		if (/^https?:\/\//.test(input)) {
			inputStream = (await this.app.inspector.request(new URL(input))).res;
		} else {
			inputStream = createReadStream(input.startsWith('file://') ? input.substring(7) : input);
		}
		if (output) {
			await pipeline(
				inputStream,
				transform.withMetadata(),
				createWriteStream(output)
			);
		} else {
			ret.buffer = await transform.toBuffer();
		}
		return ret;
	}
	static resize = {
		title: 'Resize image',
		$private: true,
		properties: {
			input: {
				title: 'Input file path',
				type: 'string',
				format: 'uri-reference'
			},
			output: {
				title: 'Output file path',
				description: 'Returns buffer when null',
				type: 'string',
				format: 'pathname',
				nullable: true
			},
			width: {
				title: 'Width',
				type: 'integer',
				minimum: 0,
				nullable: true
			},
			height: {
				title: 'Height',
				type: 'integer',
				minimum: 0,
				nullable: true
			},
			format: {
				title: 'Format options',
				type: 'object',
				required: ['name'],
				discriminator: { propertyName: "name" },
				oneOf: [{
					properties: {
						name: {
							title: 'webp',
							const: 'webp'
						},
						quality: {
							title: 'Quality',
							type: 'integer',
							minimum: 0,
							maximum: 100,
							default: 90
						},
						lossless: {
							title: 'Lossless',
							anyOf: [{
								title: 'Yes',
								const: 'yes'
							}, {
								title: 'Near',
								const: 'near'
							}, {
								title: 'No',
								type: 'null'
							}]
						}
					}
				}]
			},
			enlarge: {
				title: 'Enlarge',
				description: 'Zoom to match dimensions',
				type: 'boolean',
				nullable: true
			},
			background: {
				title: 'Background color',
				type: 'string',
				format: 'name'
			}
		}
	};

	async thumbnail(req, { url }) {
		const ret = await req.run('image.resize', {
			input: url,
			height: 64,
			enlarge: true,
			background: 'white',
			format: {
				name: 'webp',
				quality: 50
			}
		});
		const dtu = new DatauriParser();
		return dtu.format('.web', ret.buffer);
	}
	static thumbnail = {
		title: 'Thumbnail',
		$private: true,
		properties: {
			url: {
				title: 'URL',
				type: 'string',
				format: 'uri'
			}
		}
	};

	async add(req, { mime, path }) {
		if (!req.Href.isImage({ mime })) {
			return { path };
		}
		const format = mime.split('/').pop();
		if (!this.sharp.format[format]) {
			console.warn("image.add cannot process", mime);
			return { path };
		}
		return { path };
	}
	static add = {
		title: 'Add image',
		required: ['path', 'mime'],
		$private: true,
		$action: 'write',
		properties: {
			path: {
				title: 'Path',
				type: 'string'
			},
			mime: {
				title: 'Mime',
				type: 'string'
			}
		}
	};

	guess(req, { width, height, fit }) {
		for (const [suffix, item] of Object.entries(ImageModule.sizes)) {
			if (item.width >= width && item.height >= height) return suffix;
		}
	}

	async get(req, { url, size }) {
		const srcPath = this.app.statics.urlToPath(url);
		if (!srcPath) throw new HttpError.NotFound("Cannot find static path of", url);
		if (!size) return srcPath;

		const destPath = Path.join(this.app.dirs.cache, url.replace(/^\/@file/, '/images'));
		const parts = Path.parse(destPath);
		parts.name = parts.name.replace(/-(xs|s|m|l|xl)$/, '');
		const { width, height } = ImageModule.sizes[size];
		parts.name += '-' + size;
		parts.base = null;
		parts.ext = ".webp";
		const destSized = Path.format(parts);
		try {
			await fs.access(destSized);
		} catch (err) {
			if (err.code != 'ENOENT') {
				throw err;
			}
			await fs.mkdir(parts.dir, { recursive: true });
			await req.run('image.resize', {
				input: srcPath,
				output: destSized,
				width,
				height,
				format: {
					name: 'webp',
					quality: 95
				}
			});
		}
		return destSized;
	}
	static get = {
		title: 'Get rel and abs paths from URL',
		$private: true,
		$action: 'read',
		required: ['url'],
		properties: {
			url: {
				title: 'Pathname',
				type: 'string',
				format: 'pathname'
			},
			size: {
				title: 'Size',
				anyOf: Object.entries(ImageModule.sizes).map(([size, { title, width, height }]) => ({
					const: size,
					title
				}))
			}
		}
	};

	async migrate(req) {
		const limit = 100;
		let obj = { offset: 0 };
		do {
			obj = await req.run('href.search', { type: 'image', limit, offset: obj.offset });
			obj.offset += limit;
			for (const href of obj.hrefs) {
				let urlPath = href.url;
				if (urlPath.startsWith('/@file/') && req.Href.isImage(href.mime)) {
					let filePath = this.app.statics.urlToPath(urlPath);
					const parts = Path.parse(filePath);
					const patterns = [
						Path.format({ ...parts, ext: '.orig', name: parts.name + '.*' }),
						Path.format({ ...parts, ext: '.{png,jpg,jpeg,tif,tiff}' })
					];
					const list = await glob(patterns);
					if (list.length > 1) {
						throw new HttpError.Conflict("Too many files for href", urlPath, "\n", list);
					} else if (list.length == 1) {
						// rename *.ext.orig to *.ext
						// remove *.webp when *.anotherext exists
						const parts = Path.parse(list[0]);
						if (parts.ext == ".orig") {
							parts.ext = "";
							filePath = Path.format(parts);
							await fs.rename(list[0], filePath);
						} else {
							// if a file with same name and .webp extension exists, remove it
							parts.ext = ".webp";
							await fs.unlink(Path.format(parts));
							filePath = list[0];
						}
						urlPath = this.app.statics.pathToUrl(filePath);
					}
					try {
						console.info("image.migrate", filePath);
						await req.call('href.update', { url: urlPath, pathname: urlPath });
					} catch (ex) {
						if (ex.code != 'ENOENT') throw ex;
						console.warn("Missing image file:", filePath);
					}
				}
			}
		} while (obj.offset < obj.count);
	}
	static migrate = {
		title: 'Migrate site original images',
		$private: true,
		$global: false,
		$action: 'write',
		$lock: ['webmaster']
	};
};
