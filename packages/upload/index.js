var multer = require('multer');
var Path = require('path');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var speaking = require('speakingurl');

exports = module.exports = function(opt) {
	if (!opt.upload) opt.upload = {};
	if (!opt.upload.files) opt.upload.files = 100;
	if (!opt.upload.size) opt.upload.size = 50000000;
	if (!opt.upload.dir) opt.upload.dir = 'public/uploads';

	var dir = opt.upload.dir;
	if (dir.startsWith('./')) dir = opt.upload.dir = dir.substring(2);

	if (dir.startsWith('/') || dir.endsWith('/')) {
		console.error("upload.dir must not start or end with /", dir);
		console.error("disabling upload service");
		return;
	}

	return {
		service: init
	};
};

function init(All) {
	var upload = All.opt.upload;
	var dest = Path.resolve(All.cwd, upload.dir);
	console.info("Upload to :\n", dest);
	mkdirp.sync(dest);

	var storage = multer.diskStorage({
		destination: function(req, file, cb) {
			var date = (new Date()).toISOString().split('T').shift().substring(0, 7);
			var curDest = Path.join(dest, req.hostname, date);

			mkdirp(curDest, function(err) {
				if (err) return cb(err);
				cb(null, curDest);
			});
		},
		filename: function (req, file, cb) {
			var parts = file.originalname.split('.');
			var basename = speaking(parts.shift(), {truncate: 128});
			var extensions = parts.join('.').toLowerCase();
			// TODO use url-inspector to determine the real mime file type
			// and allow only specific file types

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

	All.app.post('/' + upload.dir, mw.array('files'), function(req, res, next) {
		res.send(req.files.map(function(file) {
			return '/' + Path.join(Path.relative(All.cwd, file.destination), file.filename);
		}));
	});
}

