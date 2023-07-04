const { promises: fs } = require('node:fs');
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
		const { sharp, sharpie } = await import('sharpie');
		this.sharp = sharp;
		this.sharpie = sharpie;
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
			// tag because images are transformed
			app.cache.tag('app').for(app.cache.opts.uploads),
			this.sharpie(this.opts)
		);
	}

	serviceRoutes(server) {
		console.info(`image:\tproxy at /.api/image`);
		server.get('/.api/image', (req, res, next) => {
			console.warn("/.api/image is used", req.url);
			next();
		}, this.sharpie(this.opts));
	}

	async thumbnail(url) {
		let pipeline;
		if (url.startsWith('file://')) {
			pipeline = this.sharp(url.substring(7));
		} else {
			pipeline = this.sharp();
			const req = await this.app.inspector.request(new URL(url));
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
			.toBuffer().then(buf => {
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

		await this.sharp(orig)
			.withMetadata()
			.resize({
				fit: "inside",
				withoutEnlargement: true,
				fastShrinkOnLoad: false,
				width: 2048,
				height: 2048
			})
			.toFormat("webp", {
				quality: 90,
				lossless: false,
				smartSubsample: true,
				reductionEffort: 2
			})
			.toFile(npath);
		return {
			mime: "image/webp",
			path: npath
		};
	}
	static upload = {
		title: 'Process uploaded image',
		required: ['path', 'mime'],
		$lock: true,
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
