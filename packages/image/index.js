const sharpie = require.lazy('sharpie');
const fs = require('fs').promises;
const Path = require('path');

const DataUri = require.lazy('datauri');
const allowedParameters = {
	rs: true,
	ex: true,
	q: true,
	format: true,
	fg: true,
	bg: true
};

exports = module.exports = function (opt) {
	if (!opt.image) opt.image = {};
	if (!opt.image.dir) opt.image.dir = ".image";

	if (!opt.image.signs) opt.image.signs = {
		assignment: '-',
		separator: '_'
	};

	return {
		name: 'image',
		file: initFile,
		service: initService,
		priority: 10
	};
};

function initFile(All) {
	sharpie.sharp.simd(true);
	const opt = All.opt;
	All.app.get(/^\/\.(uploads|files)\//, function (req, res, next) {
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
			Object.keys(req.query).some(function (key) {
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
	}, sharpie(All.opt.image));

	return All.utils.which(opt.image.im).catch(function () { }).then(function (path) {
		if (path) {
			opt.image.im = path;
			console.info("image:\tconverter", path);
		} else {
			console.warn("image:\tmissing converter", opt.image.im, "favicon disabled");
			delete opt.image.im;
		}
	});
}

function initService(All) {
	console.info(`image:\tproxy at /.api/image`);
	All.app.get('/.api/image', function (req, res, next) {
		console.warn("/.api/image is used", req.url);
		next();
	}, sharpie(All.opt.image));
}

function request(url) {
	const obj = require('url').parse(url);
	let agent;
	if (obj.protocol == "http:") agent = require('http');
	else if (obj.protocol == "https:") agent = require('https');
	const stream = new require('stream').PassThrough();
	// high profile web sites sniff ua/accept fields (facebook, linkedin, gmaps...)
	obj.headers = {
		"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		"Accept-Encoding": "identity",
		"Accept": "image/webp,*/*"
	};
	agent.get(obj).on('response', function (res) {
		res.pipe(stream);
	});
	return stream;
}

exports.thumbnail = function (url) {
	let pipeline;
	if (url.startsWith('file://')) {
		pipeline = sharpie.sharp(url.substring(7));
	} else {
		pipeline = sharpie.sharp();
		request(url).pipe(pipeline);
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
		.toBuffer().then(function (buf) {
			const dtu = new DataUri();
			dtu.format('.webp', buf);
			return dtu.content;
		});
};

exports.upload = function (file) {
	return Promise.resolve().then(function () {
		const mime = file.mimetype;
		if (!mime) {
			console.warn("image.upload cannot inspect file without mime type", file);
			return;
		}
		if (!mime.startsWith('image/')) return;
		if (mime.startsWith('image/svg')) return;
		const format = mime.split('/').pop();
		if (!sharpie.sharp.format[format]) {
			console.warn("image.upload cannot process", mime);
			return;
		}

		const dst = file.path + '.tmp';
		return sharpie.sharp(file.path)
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
			.toFile(dst).then(function () {
				file.mimetype = "image/webp";
				const pathObj = Path.parse(file.path);
				file.filename = pathObj.name + '.webp';
				file.path = Path.format({
					dir: pathObj.dir,
					base: file.filename
				});
				return fs.rename(dst, file.path).then(function () {
					return file;
				});
			});
	});
};
