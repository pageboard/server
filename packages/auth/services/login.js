var otp = require('otplib').authenticator;

// validity of token: 10 minutes
// accept previous token in case it has been generated just before the end of validity
otp.options = {
	step: 60 * 10,
	window: [1, 0]
};

exports = module.exports = function(opt) {
	return {
		name: 'login',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/login", function(req, res, next) {
		var type = req.query.type;
		if (!type || ['user', 'site', 'page'].indexOf(type) >= 0) {
			return next(new HttpError.BadRequest("Cannot request that type"));
		}
		All.run('block.get', req.site, req.query).then(function(data) {
			res.json(data);
		}).catch(next);
	});
}

function userPriv(data, trx) {
	return All.user.add(data).then(function(user) {
		return user.$relatedQuery('children', trx).alias('privs')
		.where('privs.type', 'priv')
		.first().throwIfNotFound().select().catch(function(err) {
			if (err.statusCode != 404) throw err;
			return user.$relatedQuery('children', trx).insert([{
				type: 'priv',
				data: {
					otp: {
						secret: otp.generateSecret()
					}
				}
			}]).returning('*');
		});
	});
}

exports.send = function(site, data) {
	return userPriv({email: data.email}).then(function(priv) {
		return otp.generate(priv.data.otp.secret);
	}).then(function(token) {
		var lang = data.lang;
		if (lang != "en") {
			console.warn("Unsupported lang", lang);
			lang = "en";
		}
		return All.mail.to({
			to: {
				address: data.email
			},
			subject: `Verification token: ${token}`,
			text: `This token is needed to complete an action you made on a Pageboard site.
It is valid for 10 minutes.
Token: ${token}`
		});
	});
};
exports.send.schema = {
	title: 'Send token',
	$action: 'write',
	required: ['email'],
	properties: {
		email: {
			title: 'User email',
			type: 'string',
			format: 'email'
		},
		lang: {
			title: 'Language',
			type: 'string',
			format: 'singleline',
			default: 'en'
		}
	}
};
exports.send.external = true;


function verifyToken(email, token) {
	return All.api.transaction(function(trx) {
		return userPriv({email: email}, trx).then(function(priv) {
			if (priv.data.otp.checked_at) {
				var at = Date.parse(priv.data.otp.checked_at);
				// allow max 3 attempts per otp lifespan
				if (Date.now() - at < otp.options.step * 1000 / 3) {
					throw new HttpError.TooManyRequests();
				}
			}
			return priv.$query(trx).patchObject({
				'data.otp.checked_at': new Date().toISOString()
			}).then(function() {
				if (!otp.check(token, priv.data.otp.secret)) {
					throw new HttpError.BadRequest("Bad token");
				}
			});
		});
	});
}

function isGranted(grants, settings) {
	if (!grants.length) return false;
	var userGrants = settings.data && settings.data.grants;
	if (!userGrants || userGrants.length == 0) return false;
	return grants.every(function(grant) {
		return userGrants.indexOf(grant) >= 0;
	});
}

exports.grant = function(site, data) {
	return verifyToken(data.email, data.token).then(function() {
		return All.run('settings.find', site, {
			email: data.email
		}).then(function(settings) {
			if (!isGranted(data.grants, settings)) {
				throw new HttpError.Forbidden("Insufficient grants");
			}
			var keys = {};
			settings.data.grants.forEach(function(grant) {
				keys[grant] = true;
			});
			return {
				cookies: {
					bearer: {
						value: All.auth.sign(site, {
							id: settings.id,
							scopes: keys
						}, All.opt.scope),
						maxAge: All.opt.scope.maxAge * 1000
					}
				}
			};
		});
	});
};

exports.grant.schema = {
	title: 'Grant',
	description: 'Sets cookie with grants',
	$action: 'write',
	required: ['email', 'token', 'grants'],
	properties: {
		email: {
			title: 'User email',
			type: 'string',
			format: 'email'
		},
		token: {
			title: 'Token',
			type: 'string',
			pattern: '\\d{6}'
		},
		grants: {
			title: 'Grants',
			type: 'array',
			uniqueItems: true,
			items: {
				type: 'string',
				format: 'id'
			}
		}
	}
};

exports.grant.external = true;


exports.clear = function(site, data) {
	return {
		cookies: {
			bearer: {}
		}
	};
};

exports.clear.schema = {
	title: 'Logout',
	description: 'Clear cookie',
	$action: 'write'
};

exports.clear.external = true;
