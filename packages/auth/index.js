var upcacheScope = require('upcache/scope');
var Path = require('path');
var pify = require('util').promisify;
var fs = {
	writeFile: pify(require('fs').writeFile),
	readFile: pify(require('fs').readFile),
	chmod: pify(require('fs').chmod)
};

exports = module.exports = function(opt) {
	return {
		priority: -10,
		name: 'auth',
		service: init
	};
};

// login: given an email, sets user.data.session.hash and returns an activation link
// validate: process activation link and return bearer in cookie

function init(All) {
	opt.scope = Object.assign({
		maxAge: 60 * 60 * 24 * 31,
		userProperty: 'user',
		keysize: 2048
	}, opt.scope);

	return keygen(All).then(function() {
		var scope = upcacheScope(opt.scope);
		All.auth.restrict = scope.restrict.bind(scope);
		All.auth.test = scope.test.bind(scope);
		All.auth.cookie = scope.serializeBearer.bind(scope);

		All.app.use('/.api/auth/*', All.cache.disable());

		All.app.get('/.api/auth/login', All.auth.restrict("auth.login"), All.query, function(req, res, next) {
			exports.login(req.query).then(function(linkObj) {
				res.send(linkObj);
			}).catch(next);
		});

		All.app.get('/.api/auth/validate', All.query, function(req, res, next) {
			exports.validate(req.query).then(function(user) {
				// check if user owns this site
				var owner = user.sites.some(function(site) {
					return site.data.domain == req.query.domain;
				});
				// upcache sets jwt.issuer to req.hostname so we should be fine
				var keys = user.keys || {};
				if (owner) keys.webmaster = true;
				scope.login(res, {
					id: user.id,
					scopes: keys
				});
				res.redirect(user.data.session.referer || '/');
			}).catch(next);
		});

		All.app.get('/.api/auth/logout', function(req, res, next) {
			scope.logout(res);
			res.redirect('back');
		});

		All.app.use(All.auth.restrict('*'));
	});
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
				return {
					type: 'login',
					data: {
						href: `/.api/auth/validate?id=${user.id}&hash=${hash}`
					}
				};
			});
		});
	});
};

exports.validate = function(data) {
	return All.user.get(data).eager('children(sites) as sites', {
		sites: function(builder) {builder.where('type', 'site');}
	}).then(function(user) {
		var hash = user.data.session && user.data.session.hash;
		if (!hash) {
			throw new HttpError.BadRequest("Unlogged user");
		}
		if (user.data.session.done) {
			throw new HttpError.BadRequest("Already logged user");
		}
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

function keygen(All) {
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
	var obj = {};
	return spawn('openssl', ['genrsa', size]).then(function(privBuf) {
		obj.private = privBuf.toString();
		return spawn('openssl', ['rsa', '-pubout'], obj.private).then(function(pubBuf) {
			obj.public = pubBuf.toString();
			return obj;
		});
	});
}

