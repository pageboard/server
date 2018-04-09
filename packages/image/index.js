var sharpie = require('sharpie');
sharpie.sharp.simd(true);

var BufferList = require('bl');
var DataUri = require('datauri');

var thumbnailer;

exports = module.exports = function(opt) {
	if (!opt.image) opt.image = {};
	if (!opt.image.dir) opt.image.dir = ".image";
	if (!opt.image.converter) opt.image.converter = 'convert';

	if (!opt.image.signs) opt.image.signs = {
		assignment: '-',
		separator: '_'
	};

	thumbnailer = sharpie(Object.assign({
		rs: `h${opt.image.signs.assignment}64${opt.image.signs.separator}max`,
		q: '70',
		bg: 'white',
		flatten: true,
		hostnames: true,
		format: 'jpeg',
		signs: opt.image.signs
	}, All.opt.thumbnail));

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
			if (!req.query.rs && !req.query.ex && !req.query.lqip) next('route');
			else next();
		}, sharpie(All.opt.image));
	}
	return All.utils.which(opt.image.converter).catch(function() {}).then(function(path) {
		if (path) {
			opt.image.converterPath = path;
			console.info("Using image converter", path);
		} else {
			console.warn("Missing image converter", opt.image.converter, "favicon disabled");
		}
	});
}

function initService(All) {
	console.info(`Remote images resizable by proxy at /.api/image`);
	All.app.get('/.api/image', sharpie(All.opt.image));
}

exports.favicon = function(path) {
	if (!All.opt.image.converterPath) throw new HttpError.NotFound("Cannot convert favicons");
	return All.utils.spawn('convert', [
		"-background", "none",
		path,
		"-define", "icon:auto-resize=64,32,16",
		"ico:-"
	], {
		cwd: All.opt.statics.runtime,
		timeout: 10 * 1000,
		env: {}
	});
};

exports.thumbnail = function(url, query) {
	return new Promise(function(resolve, reject) {
		var status, mime;
		var req = {
			params: {url: url},
			query: query || {},
			get: function() { return ''; }
		};

		var res = BufferList(function(err, data) {
			if (err) return reject(err);
			var dtu = new DataUri();
			dtu.format('.' + mime.split('/').pop(), data);
			resolve(dtu.content);
		});
		res.setHeader = function(name, value) {
			if (name.toLowerCase() == 'content-type') {
				mime = value;
			}
		};
		res.get = function() {};
		res.type = function() { return res; };
		res.status = function(code) {
			status = code;
			return res;
		};
		res.send = function(txt) {
			if (status != 200) reject(HttpError(status, txt));
			return res;
		};
		thumbnailer(req, res, function(err) {
			reject(new Error(err));
		});
	});
};
