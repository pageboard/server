var multer = require('multer');
var Path = require('path');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var pify = require('util').promisify;
var mkdirpp = pify(mkdirp);
var speaking = require('speakingurl');
var fs = {
	unlink: pify(require('fs').unlink)
};

exports = module.exports = function(opt) {
	if (!opt.upload) opt.upload = {};
	if (!opt.upload.files) opt.upload.files = 100;
	if (!opt.upload.size) opt.upload.size = 50000000;
	if (!opt.upload.dir) opt.upload.dir = "uploads";

	var dest = Path.resolve(opt.dirs.data, "uploads");
	console.info("Upload to :", dest);
	opt.directories.push({
		from: dest,
		to: opt.upload.dir
	});

	return {
		name: 'upload',
		service: init,
		dest: dest
	};
};

function init(All) {
	var upload = All.opt.upload;
	var dest = this.dest;
	return mkdirpp(dest).then(function() {
		var storage = multer.diskStorage({
			destination: function(req, file, cb) {
				var date = (new Date()).toISOString().split('T').shift().substring(0, 7);
				var curDest = Path.join(dest, req.site.id, date);

				mkdirp(curDest, function(err) {
					if (err) return cb(err);
					cb(null, curDest);
				});
			},
			filename: function (req, file, cb) {
				var parts = file.originalname.split('.');
				var basename = speaking(parts.shift(), {truncate: 128});
				var extensions = parts.join('.').toLowerCase();

				crypto.pseudoRandomBytes(4, function (err, raw) {
					if (err) return cb(err);
					cb(null, `${basename}-${raw.toString('hex')}.${extensions}`);
				});
			}
		});

		var mw = multer({
			storage: storage,
			limits: {
				files: upload.files,
				fileSize: upload.size
			}
		});

		All.app.post('/.api/upload', mw.array('files'), function(req, res, next) {
			var curDest = Path.join(dest, req.site.id);
			res.send(req.files.map(function(file) {
				return req.site.href + '/.' + Path.join(upload.dir, Path.relative(curDest, file.destination), file.filename);
			}));
		});
	});
}

exports.gc = function(id, pathname) {
	var uploadDir = All.opt.upload.dir;
	if (!id || !pathname.startsWith('/.' + uploadDir)) {
		return Promise.resolve();
	}
	var file = Path.join(uploadDir, id, pathname);
	return fs.unlink(file).catch(function() {
		// ignore error
	}).then(function() {
		console.info("gc uploaded file", file);
	});
};

