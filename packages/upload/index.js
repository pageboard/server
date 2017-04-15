var multer = require('multer');
var Path = require('path');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var speaking = require('speakingurl');
var throttle = require('express-throttle-bandwidth');

exports = module.exports = function(opt) {
	if (!opt.upload) opt.upload = {};
	if (!opt.upload.files) opt.upload.files = 100;
	if (!opt.upload.size) opt.upload.size = 50000000;
	if (opt.upload.bandwidth === undefined) {
		if (opt.env == "development") {
			console.info(" development mode");
			opt.upload.bandwidth = 500000;
		}
	}
	// currently not modifiable
	opt.upload.dir = 'public/uploads';

	return {
		service: init
	};
};

function init(All) {
	var upload = All.opt.upload;
	var dest = Path.resolve(All.cwd, upload.dir);
	console.info("Upload to :\n", dest);
	mkdirp.sync(Path.join(All.cwd, 'uploads'));

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

	var bps = opt.upload.bandwidth;
	if (bps) console.info(" bandwidth limited to", Math.round(bps / 1000) + 'KB/s');

	All.app.post('/' + upload.dir, throttle(bps), mw.array('files'), function(req, res, next) {
		res.send(req.files.map(function(file) {
			return '/' + Path.join(Path.relative(All.cwd, file.destination), file.filename);
		}));
	});
}

