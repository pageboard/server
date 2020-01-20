const multer = require.lazy('multer');
const Path = require('path');
const crypto = require.lazy('crypto');
const typeis = require('type-is');
const mime = require.lazy('mime-types');
const speaking = require.lazy('speakingurl');
const fs = require('fs').promises;

exports = module.exports = function(opt) {
	if (!opt.upload) opt.upload = {};
	if (!opt.upload.files) opt.upload.files = 100;
	if (!opt.upload.size) opt.upload.size = 50000000;

	var dest = Path.resolve(opt.dirs.data, "uploads");
	console.info(`upload:\t${dest}`);
	opt.directories.push({
		from: dest,
		to: "uploads"
	});
	opt.upload.path = dest;

	return {
		name: 'upload',
		service: function(All) {
			return fs.mkdir(dest, {recursive: true}).then(function() {
				return init(All);
			});
		}
	};
};

function init(All) {
	var upload = All.opt.upload;
	var storage = multer.diskStorage({
		destination: function(req, file, cb) {
			var date = (new Date()).toISOString().split('T').shift().substring(0, 7);
			var curDest = Path.join(upload.path, req.site.id, date);

			fs.mkdir(curDest, {recursive: true}).then(function() {
				cb(null, curDest);
			}).catch(cb);
		},
		filename: function (req, file, cb) {
			var parts = file.originalname.split('.');
			var basename = speaking(parts.shift(), {truncate: 128});
			var extensions = parts.map(function(str) {
				return speaking(str, {
					symbols: false,
					truncate: 8
				});
			}).join('.').toLowerCase();

			crypto.pseudoRandomBytes(4, function (err, raw) {
				if (err) return cb(err);
				cb(null, `${basename}-${raw.toString('hex')}.${extensions}`);
			});
		}
	});

	All.app.post('/.api/upload/:id?', function(req, res, next) {
		Promise.resolve().then(function() {
			var limits = {
				files: upload.files,
				size: upload.size,
				types: ['*/*']
			};
			if (req.params.id) {
				return All.run('block.get', req, {id: req.params.id}).then(function(input) {
					return Object.assign(limits, input.data.limits);
				});
			} else {
				return limits;
			}
		}).then(function(limits) {
			multer({
				storage: storage,
				fileFilter: function(req, file, cb) {
					var types = limits.types.length ? limits.types : ['*/*'];
					cb(null, !!typeis.is(file.mimetype, types));
				},
				limits: {
					files: limits.files,
					fileSize: limits.size
				}
			}).array('files')(req, res, function() {
				return Promise.all(req.files.map(function(file) {
					return exports.file(req, file);
				})).then(function(list) {
					// backward compatibility with elements-write's input href
					var obj = req.params.id ? {items: list} : list;
					res.send(obj);
				}).catch(next);
			});
		});
	});
}

exports.file = function({site}, data) {
	var upload = All.opt.upload;
	var dest = Path.join(upload.path, site.id);
	if (!data.filename) data.filename = Path.basename(data.path);
	if (!data.destination) data.destination = Path.dirname(data.path);
	if (!data.mimetype) data.mimetype = mime.lookup(Path.extname(data.filename));

	return All.image.upload(data).then(function() {
		return '/.' + Path.join(
			"uploads",
			Path.relative(dest, data.destination),
			data.filename
		);
	});
};
exports.file.schema = {
	title: 'Upload file',
	required: ['path'],
	properties: {
		path: {
			title: 'File path',
			type: 'string'
		},
		filename: {
			type: 'string',
			nullable: true
		},
		destination: {
			type: 'string',
			nullable: true
		},
		mimetype: {
			type: 'string',
			nullable: true
		}
	}
};

exports.gc = function(id, pathname) {
	if (!id || !pathname.startsWith('/.uploads')) {
		return Promise.resolve();
	}
	var file = Path.join("uploads", id, pathname);
	return fs.unlink(file).catch(function() {
		// ignore error
	}).then(function() {
		console.info("gc uploaded file", file);
	});
};

