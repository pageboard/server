var sharpie = require('sharpie');
var BufferList = require('bl');
var DataUri = require('datauri');

var thumbnailer;

exports = module.exports = function(opt) {
	if (!opt.image) opt.image = {};
	if (!opt.image.dir) opt.image.dir = opt.upload && opt.upload.dir || 'public/uploads';

	thumbnailer = sharpie(Object.assign({
		rs: 'h:128,max',
		q: '75',
		bg: 'white',
		flatten: true,
		hostnames: true
	}, All.opt.thumbnail));

	return {
		name: image,
		file: init
	};
};

// deux cas potentiels
// - un fichier uploadé est utilisé comme une image, /public/uploads/file.jpg?rs=xxx
// - un fichier distant est utilisé comme une image. On ne peut pas redimensionner.
// - fabriquer un thumbnail à partir d'une image distante

function init(All) {
	All.app.get(`:url(/${All.opt.image.dir}/.*)`, sharpie(All.opt.image));
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
