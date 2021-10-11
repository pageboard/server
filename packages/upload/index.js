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

	const dest = Path.resolve(opt.dirs.data, "uploads");
	console.info(`upload:\t${dest}`);
	opt.directories.push({
		from: dest,
		to: "uploads"
	});
	opt.upload.path = dest;

	return {
		name: 'upload',
		service: function(All) {
			return fs.mkdir(dest, {recursive: true}).then(() => {
				return init(All);
			});
		}
	};
};

function init(All) {
	const upload = All.opt.upload;
	const storage = multer.diskStorage({
		destination: function(req, file, cb) {
			const date = (new Date()).toISOString().split('T').shift().substring(0, 7);
			const curDest = Path.join(upload.path, req.site.id, date);

			fs.mkdir(curDest, {recursive: true}).then(() => {
				cb(null, curDest);
			}).catch(cb);
		},
		filename: function (req, file, cb) {
			const parts = file.originalname.split('.');
			const ext = speaking(parts.pop(), {
				truncate: 8,
				symbols: false
			});
			const basename = speaking(parts.join('-'), {
				truncate: 128,
				symbols: false
			});
			crypto.pseudoRandomBytes(4, (err, raw) => {
				if (err) return cb(err);
				cb(null, `${basename}-${raw.toString('hex')}.${ext}`);
			});
		}
	});

	All.app.post('/.api/upload/:id?', (req, res, next) => {
		Promise.resolve().then(() => {
			const limits = {
				files: upload.files,
				size: upload.size,
				types: ['*/*']
			};
			if (req.params.id) {
				return All.run('block.get', req, {id: req.params.id}).then((input) => {
					return Object.assign(limits, input.data.limits);
				});
			} else {
				return limits;
			}
		}).then((limits) => {
			multer({
				storage: storage,
				fileFilter: function(req, file, cb) {
					const types = limits.types.length ? limits.types : ['*/*'];
					cb(null, Boolean(typeis.is(file.mimetype, types)));
				},
				limits: {
					files: limits.files,
					fileSize: limits.size
				}
			}).array('files')(req, res, () => {
				return Promise.all(req.files.map((file) => {
					return exports.file(req, file);
				})).then((list) => {
					// backward compatibility with elements-write's input href
					const obj = req.params.id ? {items: list} : list;
					res.send(obj);
				}).catch(next);
			});
		});
	});
}

exports.file = function({site}, data) {
	const upload = All.opt.upload;
	const dest = Path.join(upload.path, site.id);
	if (!data.filename) data.filename = Path.basename(data.path);
	if (!data.destination) data.destination = Path.dirname(data.path);
	if (!data.mimetype) data.mimetype = mime.lookup(Path.extname(data.filename));

	return All.image.upload(data).then(() => {
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
	const file = Path.join("uploads", id, pathname);
	return fs.unlink(file).catch(() => {
		// ignore error
	}).then(() => {
		console.info("gc uploaded file", file);
	});
};

