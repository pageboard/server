var upcacheScope = require('upcache/scope');
var Path = require('path');
var pify = require('util').promisify;
var fs = {
	writeFile: pify(require('fs').writeFile),
	readFile: pify(require('fs').readFile),
	chmod: pify(require('fs').chmod)
};

exports = module.exports = function(opt) {
	opt.scope = Object.assign({
		issuer: opt.name,
		maxAge: 3600 * 12,
		userProperty: 'user'
	}, opt.scope);

	exports.scope = upcacheScope(opt.scope);
	exports.restrict = exports.scope.restrict.bind(exports.scope);

	return {
		name: 'auth',
		service: init
	};
};

// login: given an email, sets user.data.session.hash and returns user id
// activate: given an id, returns an activation link
// validate: process activation link and return bearer in cookie

function init(All) {
	All.app.use('/.api/auth/*', All.cache.disable());

	All.app.get('/.api/auth/activate', All.query, function(req, res, next) {
		exports.activate(req.query).then(function(linkObj) {
			res.send(linkObj);
		}).catch(next);
	});

	All.app.get('/.api/auth/validate', All.query, function(req, res, next) {
		exports.validate(req.query).then(function(user) {
			exports.scope.login(res, {
				id: user.id,
				scopes: user.data.grants || []
			});
			res.redirect(user.data.session.referer || '/');
		}).catch(next);
	});

	All.app.get('/.api/auth/logout', function(req, res, next) {
		exports.scope.logout(res);
		res.redirect('back');
	});

	return exports.keygen();
}

exports.login = function(data) {
	return All.user.get(data).then(function(user) {
		return All.api.Block.genId(16).then(function(hash) {
			return user.$query().where('id', user.id).skipUndefined().patch({
				'data:session': {
					hash: hash,
					done: false,
					referer: data.referer
				}
			}).then(function(count) {
				if (count == 0) throw new HttpError.NotFound("TODO use a transaction here");
				return {id: user.id};
			});
		});
	});
};

exports.activate = function(data) {
	return All.user.get(data).then(function(user) {
		var hash = user.data.session && user.data.session.hash;
		if (!hash) {
			throw new HttpError.BadRequest("Call auth.login before auth.validationLink");
		}
		return {
			type: 'auth',
			data: {
				href: All.domains.host(data.domain) + `/.api/auth/validate?id=${user.id}&hash=${hash}`
			}
		};
	});
};

exports.validate = function(data) {
	return All.user.get(data).then(function(user) {
		var hash = user.data.session && user.data.session.hash;
		if (!hash) {
			throw new HttpError.BadRequest("Unlogged user");
		}
		/* TODO REENABLE THIS
		if (user.data.session.done) {
			throw new HttpError.BadRequest("Already logged user");
		}
		*/
		if (hash != data.hash) {
			throw new HttpError.BadRequest("Bad validation link");
		}
		return user.$query().where('id', user.id).skipUndefined().patch({
			'data:session.done': true
		}).then(function(count) {
			if (count == 0) throw new HttpError.NotFound("User has been deleted since activation");
			return user;
		});
	});
};

exports.keygen = function() {
	var keysPath = Path.join(All.opt.dirs.data, 'keys.json');
	return fs.readFile(keysPath).then(function(buf) {
		return JSON.parse(buf.toString());
	}).catch(function() {
		// generate private/public keys and store in keysPath
		return sshKeygen(All.opt.scope.keysize).then(function(obj) {
			return fs.writeFile(keysPath, JSON.stringify(obj)).then(function() {
				return fs.chmod(keysPath, 0600);
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
	if (!size) size = 2048;
	var obj = {};
	return spawn('openssl', ['genrsa', size]).then(function(privBuf) {
		obj.private = privBuf.toString();
		return spawn('openssl', ['rsa', '-pubout'], obj.private).then(function(pubBuf) {
			obj.public = pubBuf.toString();
			return obj;
		});
	});
}

