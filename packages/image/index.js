const { promises: fs, createReadStream } = require('node:fs');
const Path = require('node:path');

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

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			param(req) {
				return app.statics.get(req);
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
			/^\/\.(uploads|files)\//,
			this.mw,
			// files are loaded directly and need some headers
			app.cache.for({
				immutable: true,
				maxAge: app.cache.opts.uploads
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

		const pipeline = this.sharp()
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
			pipeline.flatten({
				background
			});
		}
		if (/^https?:\/\//.test(input)) {
			const req = await this.app.inspector.request(new URL(input));
			req.res.pipe(pipeline);
		} else {
			createReadStream(input.startsWith('file://') ? input.substring(7) : input).pipe(pipeline);
		}
		if (output) {
			pipeline.withMetadata();
			await pipeline.toFile(output);
		} else {
			const buf = await pipeline.toBuffer();
			const dtu = new DatauriParser();
			ret.uri = dtu.format(`.${format.name}`, buf);
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
		return ret.uri;
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
	async upload(req, { mime, path }) {
		if (!mime) {
			console.warn("image.upload cannot inspect file without mime type", mime, path);
			return;
		}
		if (!mime.startsWith('image/')) return;
		if (mime.startsWith('image/svg')) return;
		const format = mime.split('/').pop();
		if (!this.sharp.format[format]) {
			console.warn("image.upload cannot process", mime);
			return;
		}
		const orig = path + ".orig";
		await fs.rename(path, orig);
		const pathObj = Path.parse(path);
		const filename = pathObj.name + '.webp';
		const npath = Path.format({
			dir: pathObj.dir,
			base: filename
		});

		return req.run('image.resize', {
			input: orig,
			output: npath,
			width: 2362, // 200mm at 300dpi
			height: 3390, // 287mm at 300dpi
			format: {
				name: 'webp',
				quality: 95
			}
		});
	}
	static upload = {
		title: 'Process uploaded image',
		required: ['path', 'mime'],
		$private: true,
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
};
