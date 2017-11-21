var sharpie = require('sharpie');
var BufferList = require('bl');
var DataUri = require('datauri');

var thumbnailer;

exports = module.exports = function(opt) {
	if (!opt.image) opt.image = {};
	if (!opt.image.dir) opt.image.dir = ".image";

	thumbnailer = sharpie(Object.assign({
		rs: 'h:64,max',
		q: '70',
		bg: 'white',
		flatten: true,
		hostnames: true,
		format: 'jpeg'
	}, All.opt.thumbnail));

	return {
		name: 'image',
		file: initFile,
		service: initService,
		priority: 10
	};
};

// deux cas potentiels
// - un fichier uploadé est utilisé comme une image, /public/uploads/file.jpg?rs=xxx
// - un fichier distant est utilisé comme une image. On ne peut pas redimensionner.
// - fabriquer un thumbnail à partir d'une image distante

function initFile(All) {
	var opt = All.opt;
	var uploadDir = opt.upload && opt.upload.dir;
	if (uploadDir) {
		uploadDir = "." + uploadDir;
		console.info("Images resizable by upload at", "/" + uploadDir);
		All.app.get(`:url(/${uploadDir}/*)`, function(req, res, next) {
			if (!req.query.rs && !req.query.ex) next('route');
			else next();
		}, sharpie(All.opt.image));
	}
}

function initService(All) {
	console.info(`Images resizable by proxy at /.api/image`);
	All.app.get(`/.api/image`, sharpie(All.opt.image));
}

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
