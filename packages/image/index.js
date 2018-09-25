var sharpie = require('sharpie');
var sharp = sharpie.sharp;
var pify = require('util').promisify;
var fs = {
	rename: pify(require('fs').rename)
};

var DataUri = require('datauri');
var allowedParameters = {
	rs: true,
	ex: true,
	q: true,
	format: true
};

exports = module.exports = function(opt) {
	sharp.simd(true);
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
	var opt = All.opt;
	var uploadDir = opt.upload && opt.upload.dir;
	if (uploadDir) {
		uploadDir = "." + uploadDir;
		console.info("Uploaded images resizable by upload at", "/" + uploadDir);
		All.app.get(`:url(/${uploadDir}/*)`, function(req, res, next) {
			var hasParam = false;
			var wrongParam = false;
			Object.keys(req.query).forEach(function(key) {
				if (allowedParameters[key]) hasParam = true;
				else wrongParam = true;
			});
			if (wrongParam) {
				res.sendStatus(400);
			} else if (hasParam) {
				next();
			} else {
				next('route');
			}
		}, sharpie(All.opt.image));
	}
	return All.utils.which(opt.image.im).catch(function() {}).then(function(path) {
		if (path) {
			opt.image.im = path;
			console.info("Using image converter", path);
		} else {
			console.warn("Missing image converter", opt.image.im, "favicon disabled");
			delete opt.image.im;
		}
	});
}

function initService(All) {
	console.info(`Remote images resizable by proxy at /.api/image`);
	All.app.get('/.api/image', function(req, res, next) {
		console.warn("/.api/image is used", req.url);
		next();
	}, sharpie(All.opt.image));
}

function request(url) {
	var obj = require('url').parse(url);
	var agent;
	if (obj.protocol == "http:") agent = require('http');
	else if (obj.protocol == "https:") agent = require('https');
	var stream = new require('stream').PassThrough();
	// high profile web sites sniff ua/accept fields (facebook, linkedin, gmaps...)
	obj.headers = {
		"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		"Accept-Encoding": "identity",
		"Accept": "*/*"
	};
	agent.get(obj).on('response', function(res) {
		res.pipe(stream);
	});
	return stream;
}

exports.thumbnail = function(url) {
	var pipeline;
	if (url.startsWith('file://')) {
		pipeline = sharp(url.substring(7));
	} else {
		pipeline = sharp();
		request(url).pipe(pipeline);
	}
	return pipeline
	.resize(null, 64)
	.max()
	.background('white')
	.flatten()
	.toFormat('jpeg', {
		quality: 65
	})
	.toBuffer().then(function(buf) {
		var dtu = new DataUri();
		dtu.format('.jpeg', buf);
		return dtu.content;
	});
};

exports.upload = function(file) {
	return Promise.resolve().then(function() {
		var mime = file.mimetype;
		if (!mime) {
			console.warn("image.upload cannot inspect file without mime type", file);
			return;
		}
		if (!mime.startsWith('image/')) return;
		if (mime.startsWith('image/svg')) return;
		var format = mime.split('/').pop();
		if (!sharp.format[format]) {
			console.warn("image.upload cannot process", mime);
			return;
		}
		var dst = file.path + ".tmp";
		return sharp(file.path)
		.toFormat(format, {quality:93})
		.toFile(dst).then(function() {
			return fs.rename(dst, file.path);
		});
	});
};
