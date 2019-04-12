const Path = require('path');
const pify = require('util').promisify;
const fs = {
	writeFile: pify(require('fs').writeFile),
	readFile: pify(require('fs').readFile),
	chmod: pify(require('fs').chmod)
};
const generateKeyPair = pify(require('crypto').generateKeyPair);

module.exports = function(All) {
	var keysPath = Path.join(All.opt.dirs.data, 'keys.json');
	return fs.readFile(keysPath).then(function(buf) {
		return JSON.parse(buf.toString());
	}).catch(function() {
		return generateKeyPair('rsa', {
			modulusLength: 4096,
			publicKeyEncoding: {
				type: 'pkcs1',
				format: 'pem'
			},
			privateKeyEncoding: {
				type: 'pkcs1',
				format: 'pem'
			}
		}).then(function(keys)  {
			return fs.writeFile(keysPath, JSON.stringify(keys)).then(function() {
				return fs.chmod(keysPath, 0o600);
			}).then(function() {
				return keys;
			});
		});
	}).then(function(keys) {
		// deal with old format
		if (keys.public) {
			keys.publicKey = keys.public;
			delete keys.public;
		}
		if (keys.private) {
			keys.privateKey = keys.private;
			delete keys.private;
		}
		return keys;
	});
};

