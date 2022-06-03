const sharpie = require.lazy('sharpie');
const { promises: fs } = require('fs');
const Path = require('path');

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

	constructor(app, opts) {
		this.app = app;
		this.opts = {
			dir: '.image',
			signs: {
				assignment: '-',
				separator: '_'
			},
			...opts
		};
	}

	fileRoutes(app, server) {
		sharpie.sharp.simd(true);
		server.get(/^\/\.(uploads|files)\//, (req, res, next) => {
			Log.image("processing", req.url);
			const extname = Path.extname(req.path);
			if (!extname || /png|jpe?g|gif|webp|tiff|svg/.test(extname.substring(1)) == false) {
				return next('route');
			}
			if (req.query.raw === "" || req.query.raw === null) {
				if (Object.keys(req.query).length != 1) {
					res.sendStatus(400);
				} else {
					next('route');
				}
			} else {
				const wrongParams = [];
				Object.keys(req.query).some((key) => {
					if (!allowedParameters[key]) wrongParams.push(key);
				});
				if (wrongParams.length) {
					Log.image("wrong image params", req.url, wrongParams);
					res.sendStatus(400);
				} else {
					Log.image(req.url);
					req.params.url = req.path + "?raw";
					next();
				}
			}
		}, sharpie(this.opts));
	}

	serviceRoutes(server) {
		console.info(`image:\tproxy at /.api/image`);
		server.get('/.api/image', (req, res, next) => {
			console.warn("/.api/image is used", req.url);
			next();
		}, sharpie(this.opts));
	}

	async thumbnail(url) {
		let pipeline;
		if (url.startsWith('file://')) {
			pipeline = sharpie.sharp(url.substring(7));
		} else {
			pipeline = sharpie.sharp();
			const req = await this.app.inspector.request(url);
			req.res.pipe(pipeline);
		}
		return pipeline
			.resize({
				fit: "inside",
				height: 64
			})
			.flatten({
				background: 'white'
			})
			.toFormat('webp', {
				quality: 50
			})
			.toBuffer().then((buf) => {
				const dtu = new DatauriParser();
				return dtu.format('.webp', buf);
			});
	}
	async upload(req, { mime, path }) {
		if (!mime) {
			console.warn("image.upload cannot inspect file without mime type", mime, path);
			return;
		}
		if (!mime.startsWith('image/')) return;
		if (mime.startsWith('image/svg')) return;
		const format = mime.split('/').pop();
		if (!sharpie.sharp.format[format]) {
			console.warn("image.upload cannot process", mime);
			return;
		}

		const dst = path + '.tmp';
		await sharpie.sharp(path)
			.withMetadata()
			.resize({
				fit: "inside",
				withoutEnlargement: true,
				fastShrinkOnLoad: false,
				width: 2560,
				height: 2560
			})
			.toFormat("webp", {
				quality: 100,
				lossless: true,
				smartSubsample: true,
				reductionEffort: 2
			})
			.toFile(dst);
		const pathObj = Path.parse(path);
		const filename = pathObj.name + '.webp';
		const npath = Path.format({
			dir: pathObj.dir,
			base: filename
		});
		await fs.rename(dst, npath);
		return {
			mime: "image/webp",
			path: npath
		};
	}
	static upload = {
		title: 'Process uploaded image',
		required: ['path', 'mime'],
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
