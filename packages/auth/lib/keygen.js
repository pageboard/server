var Path = require('path');
var pify = require('util').promisify;
var fs = {
	writeFile: pify(require('fs').writeFile),
	readFile: pify(require('fs').readFile),
	chmod: pify(require('fs').chmod)
};

module.exports = function(All) {
	var keysPath = Path.join(All.opt.dirs.data, 'keys.json');
	return fs.readFile(keysPath).then(function(buf) {
		return JSON.parse(buf.toString());
	}).catch(function() {
		// generate private/public keys and store in keysPath
		return sshKeygen(All.opt.scope.keysize).then(function(obj) {
			return fs.writeFile(keysPath, JSON.stringify(obj)).then(function() {
				return fs.chmod(keysPath, 0o600);
			}).then(function() {
				return obj;
			});
		});
	}).then(function(keys) {
		All.opt.scope.privateKey = keys.private;
		All.opt.scope.publicKey = keys.public;
	});
};

function sshKeygen(size) {
	var spawn = require('spawn-please');
	var obj = {};
	return spawn('openssl', ['genrsa', size]).then(function(privBuf) {
		obj.private = privBuf.toString();
		return spawn('openssl', ['rsa', '-pubout'], obj.private).then(function(pubBuf) {
			obj.public = pubBuf.toString();
			return obj;
		});
	});
}
