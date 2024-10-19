const {
	promises: fs,
	createReadStream,
	createWriteStream
} = require('node:fs');
const { pipeline } = require('node:stream/promises');
const Path = require('node:path');
const { glob } = require('glob');
const bwipjs = require('bwip-js');

const DatauriParser = require('datauri/parser');
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
			width: 128,
			height: 128
		},
		s: {
			title: 'Small',
			width: 256,
			height: 256
		},
		m: {
			title: 'Medium',
			width: 512,
			height: 512
		},
		l: {
			title: 'Large',
			width: 1024,
			height: 1024
		},
		xl: {
			title: 'Extra Large',
			width: 2048,
			height: 2048
		},
		xxl: {
			title: 'Super Extra Large',
			width: 4096,
			height: 4096
		}
	};

	static regSizes = new RegExp(`-(${Object.keys(this.sizes).join('|')})$`);

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			async param(req, { rs }) {
				const size = req.call('image.guess', {
					width: rs?.w ?? 0,
					height: rs?.h ?? 0,
					fit: rs.fit
				});
				const path = await req.call('image.get', {
					url: req.path,
					size
				});
				if (!path) throw new HttpError.NotFound();
				return path;
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
			res.accelerate(this.app.statics.urlToPath(req, req.path));
			return;
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

	fileRoutes(router) {
		router.get(
			"/share/*",
			this.mw,
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
			inputStream = (await this.app.inspector.request(req, new URL(input))).res;
		} else {
			inputStream = createReadStream(input.startsWith('file://') ? input.substring(7) : input);
		}
		if (output) {
			try {
				await pipeline(
					inputStream,
					transform.withMetadata(),
					createWriteStream(output)
				);
			} catch (ex) {
				try {
					await fs.unlink(output);
				} catch {
					// pass
				}
				throw ex;
			}
		} else {
			ret.buffer = (await Promise.all([
				pipeline(inputStream, transform),
				transform.toBuffer()
			])).pop();
		}
		return ret;
	}
	static resize = {
		title: 'Resize',
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

	async thumbnail(req, { url, height = 64 }) {
		const size = req.call('image.guess', { height });
		const input = /^https?:\/\//.test(url)
			? url
			: await req.call('image.get', { url, size });
		if (!input) throw new HttpError.NotFound();
		const format = "webp";
		const ret = await req.run('image.resize', {
			input,
			height,
			enlarge: true,
			background: 'white',
			format: {
				name: format,
				quality: 50
			}
		});
		const dtu = new DatauriParser();
		return dtu.format(`.${format}`, ret.buffer).content;
	}
	static thumbnail = {
		title: 'Thumbnail',
		$private: true,
		properties: {
			url: {
				title: 'File path',
				type: 'string',
				format: 'uri-reference'
			}
		}
	};

	async add(req, { mime, path }) {
		if (!req.sql.Href.isImage(mime)) {
			return { path };
		}
		const format = mime.split('/').pop();
		if (!this.sharp.format[format]) {
			console.warn("image.add cannot process", mime);
			return { path };
		}
		// store images without extensions
		const parts = Path.parse(path);
		const npath = Path.format({
			...parts,
			base: null,
			ext: '.webp'
		});
		await fs.rename(path, npath);
		path = npath;
		return { path };
	}
	static add = {
		title: 'Add',
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

	guess(req, { width = 0, height = 0, fit }) {
		if (!width) width = height;
		if (!height) height = width;
		if (!width && !height) return null;
		for (const [suffix, item] of Object.entries(ImageModule.sizes)) {
			if (item.width >= width && item.height >= height) return suffix;
		}
	}

	async get(req, { url, size }) {
		let srcPath = this.app.statics.urlToPath(req, url);
		if (!srcPath) return;
		const srcParts = Path.parse(srcPath);
		srcParts.base = null;
		if (srcParts.ext == ".svg") return srcPath;
		srcParts.ext = ".webp";
		srcPath = Path.format(srcParts);
		if (!size) return srcPath;

		const destPath = this.app.statics.urlToPath(req, url.replace(/^\/@file\/share/, "/@file/image/"));

		const parts = Path.parse(destPath);
		parts.name = parts.name.replace(ImageModule.regSizes, '');
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
			try {
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
			} catch(err) {
				console.error(err.message);
				return;
			}
		}
		return destSized;
	}
	static get = {
		title: 'Get path at given size',
		$private: true,
		required: ['url'],
		properties: {
			url: {
				title: 'Pathname',
				type: 'string',
				format: 'pathname'
			},
			size: {
				title: 'Size',
				anyOf: [
					{ type: "null", title: "Original" },
					...Object.entries(ImageModule.sizes)
						.map(([size, { title, width, height }]) => ({
							const: size,
							title,
							description: `${width}x${height}`
						}))
				]
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
				if (!urlPath.startsWith('/@file/') || !req.sql.Href.isImage(href.mime)) {
					continue;
				}
				let filePath = this.app.statics.urlToPath(req, urlPath);
				const parts = Path.parse(filePath);
				parts.base = null;
				const patterns = [
					Path.format({
						...parts,
						ext: '.{png,jpg,jpeg,tif,tiff}.orig'
					}),
					Path.format({
						...parts,
						ext: '.{png,jpg,jpeg,tif,tiff,webp}'
					})
				];
				const list = await glob(patterns);
				if (list.length == 0) {
					const noextlist = await glob(Path.format({
						...parts,
						ext: null
					}) + '*', {
						ignore: Path.format({
							...parts,
							ext: '.*'
						})
					});
					if (noextlist.length == 1) {
						console.warn("Restoring webp extension");
						list.push(noextlist[0]);
					} else {
						console.warn("Missing image file:", filePath);
						continue;
					}
				}
				const origIndex = list.findIndex(item => item.endsWith('.orig'));
				let orig = origIndex >= 0 ? list[origIndex] : null;
				if (orig) {
					list.splice(origIndex, 1);
					parts.ext = null;
					Object.assign(parts, Path.parse(Path.format(parts)));
					parts.base = null;
				} else {
					list.sort();
					orig = list.pop(); // the webp or any other
				}
				parts.ext = '.webp';
				filePath = Path.format(parts);
				await fs.rename(orig, filePath);
				urlPath = this.app.statics.pathToUrl(req, filePath);
				for (const item of list) {
					await fs.unlink(item);
				}
				console.info("image.migrate", filePath);
				if (urlPath != href.url) {
					await req.call('href.change', {
						from: href.url,
						to: urlPath
					});
				}
				if (href.pathname != urlPath) await req.call('href.update', {
					url: urlPath,
					pathname: urlPath
				});
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

	async barcode(req, data) {
		const opts = {
			...data,
			includetext: true,
			textalign: 'center'
		};
		delete opts.format;
		opts.textcolor = opts.barcolor = opts.bordercolor = data.color;
		const ret = {};
		if (data.format == "svg") {
			ret.type = ".svg";
			ret.mime = "image/svg+xml";
			ret.buf = bwipjs.toSVG(opts);
		} else if (data.format == "png") {
			ret.type = ".png";
			ret.mime = "image/png";
			ret.buf = await bwipjs.toBuffer(opts);
		}
		if (data.uri) {
			const dtu = new DatauriParser();
			return dtu.format(ret.type, ret.buf).content;
		} else {
			req.res.type(ret.mime);
			return ret.buf;
		}
	}
	static barcode = {
		title: 'Get Barcode',
		$action: 'read',
		properties: {
			format: {
				title: 'Image format',
				anyOf: [{
					const: "svg",
					title: 'svg'
				}, {
					const: "png",
					title: 'png'
				}]
			},
			uri: {
				title: 'Data Uri',
				type: 'boolean',
				default: false
			},
			bcid: {
				title: 'Barcode type',
				anyOf: [{
					const: 'qrcode',
					title: 'QR Code'
				}, {
					const: 'ean13',
					title: 'EAN-13'
				}, {
					const: 'upca',
					title: 'UPC-A'
				}, {
					const: 'isbn',
					title: 'ISBN'
				}],
				default: 'qrcode'
			},
			text: {
				title: 'Text to encode',
				type: 'string',
				format: 'singleline'
			},
			textxalign: {
				title: 'Text X align',
				anyOf: [{
					const: "center",
					title: 'Center'
				}, {
					const: "left",
					title: 'Left'
				}, {
					const: "center",
					title: 'Center'
				}, {
					const: "Right",
					title: 'Right'
				}, {
					const: "justify",
					title: 'Justify'
				}]
			},
			scaleX: {
				title: 'X scale',
				type: 'integer',
				default: 2
			},
			scaleY: {
				title: 'Y scale',
				type: 'integer',
				default: 2
			},
			color: {
				title: 'Front color',
				type: 'string',
				format: 'hex-color',
				$helper: 'color',
				default: '#000000'
			},
			rotate: {
				title: 'Rotate',
				anyOf: [{
					type: 'null',
					title: 'No'
				}, {
					const: 'R',
					title: 'Right',
				}, {
					const: 'L',
					title: 'Left',
				}, {
					const: 'I',
					title: 'Inverted'
				}]
			}
		}
	};
};
