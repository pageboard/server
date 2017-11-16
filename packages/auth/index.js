var upcacheScope = require('upcache/scope');
var pify = require('pify');
var bcrypt = pify(require('bcrypt')); // consider using argon2
var appSalt; // keep it private

exports = module.exports = function(opt) {
	opt.scope = Object.assign({
		issuer: opt.name,
		maxAge: 3600 * 12,
		userProperty: 'user',
		saltRounds: 10 // this should grow over the years
	}, opt.scope);

	exports.scope = upcacheScope(opt.scope);
	exports.restrict = exports.scope.restrict.bind(exports.scope);

	return {
		name: 'auth',
		service: init
	};
};

function init(All) {
	All.app.post('/.api/login', function(req, res, next) {
		exports.authenticate(req.body).then(function(user) {
			exports.scope.login(res, {
				email: user.data.email,
				scopes: user.data.grants
			});
		}).catch(next);
	});
	All.app.post('/.api/logout', function(req, res, next) {
		exports.logout(res);
	});

	All.app.get('/.api/user', function(req, res, next) {
		All.user.get(req.query).then(function(user) {
			if (!user) throw new HttpError.NotFound("No user found");
			if (All.scope.test(req, "user-" + user.id)) {
				res.send(user);
			} else {
				throw new HttpError.Unauthorized("Cannot read another user");
			}
		}).catch(next);
	});

	All.app.get('/.api/verify', All.cache.disable(), function(req, res, next) {
		exports.verify(req.query).then(function(user) {
			res.send(user);
		}).catch(next);
	});

	// TODO rate limit
	All.app.post('/.api/user', function(req, res, next) {
		exports.create(req.body).then(function(user) {
			res.send(user);
		}).catch(next);
	});

	All.app.put('/.api/user/:id', exports.restrict("user-:id"), function(req, res, next) {
		delete req.body.password;
		delete req.body.email;
		delete req.body.verified;
		req.body.id = req.params.id;
		All.user.save(req.body).then(function(user) {
			res.send(user);
		}).catch(next);
	});

	All.app.delete('/.api/user/:id', exports.restrict("user-:id"), function(req, res, next) {
		All.user.del(req.params).then(function(user) {
			res.sendStatus(200);
		}).catch(next);
	});

	return bcrypt.genSalt(All.opt.scope.saltRounds).then(function(salt) {
		appSalt = salt;
	});
}

exports.authenticate = function(data) {
	if (!data.email) {
		throw new HttpError.BadRequest("Missing email");
	}
	if (!data.password) {
		throw new HttpError.BadRequest("Missing password");
	}
	return All.user.get({email: data.email}).then(function(user) {
		if (!user.password || !data.password) throw new HttpError.BadRequest("Cannot login without password");
		return bcrypt.compare(data.password, user.password).then(function(isValid) {
			if (!isValid) throw new HttpError.BadRequest("Wrong password");
			return user;
		});
	});
};

exports.logout = function(res) {
	exports.scope.logout(res);
};

// TODO transaction
exports.create = function(data) {
	return All.user.get({email: data.email}).then(function(user) {
		if (user) throw new HttpError.BadRequest("User already exists");
		if (!data.password) return data;
		return Promise.all([
			bcrypt.hash(data.password, appSalt),
			bcrypt.hash(data.email, appSalt)
		]);
	}).then(function(hpass, hmail) {
		data.password = hpass;
		data.verification = hmail;
		return All.user.add({
			data: data
		}).then(function(user) {
			// TODO send email to user
			console.log(`Send email to user with link to /.api/verify?email=${user.data.email}&verification=${user.data.verification}`);
			if (user.data.password) delete user.data.password;
			if (user.data.verification) delete user.data.verification;
			return user;
		});
	});
};

exports.verify = function(data) {
	return All.user.get({email: data.email}).then(function(user) {
		if (!user) throw new HttpError.NotFound("No user found");
		if (!user.data.verification) return;
		if (user.data.verification != data.verification) throw new HttpError.BadRequest("Wrong verification");
		return All.user.save({
			id: user.id,
			'data.verification': null
		});
	});
};

exports.passchange = function() {
	// TODO a bit the same manipulation as create, but only for updating the password
};

// TODO probably need something better
exports.delete = function(data) {
	return All.user.del(data);
};

