var otp = require('otplib').authenticator;
var URL = require('url');

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
		All.run('login.grant', req.site, req.query).then(function(data) {
			data.location = "back";
			All.send(res, data);
		}).catch(next);
	});

	All.app.get("/.api/logout", function(req, res, next) {
		All.run('login.clear', req.site, req.query).then(function(data) {
			data.location = "back";
			All.send(res, data);
		}).catch(next);
	});
}

function userPriv(user, trx) {
	return user.$relatedQuery('children', trx).alias('privs')
	.where('privs.type', 'priv')
	.first().throwIfNotFound().select().catch(function(err) {
		if (err.statusCode != 404) throw err;
		return user.$relatedQuery('children', trx).insert({
			type: 'priv',
			data: {
				otp: {
					secret: otp.generateSecret()
				}
			}
		}).returning('*');
	});
}

function generate(site, data) {
	return Promise.resolve().then(function() {
		if (data.register) return All.user.add({email: data.email});
	}).then(function() {
		return All.user.get({email: [data.email]}).select('_id');
	}).then(function(user) {
		return userPriv(user);
	}).then(function(priv) {
		return otp.generate(priv.data.otp.secret);
	});
}

exports.send = function(site, data) {
	if (!site.href) {
		return "login.send requires a hostname. Use login.link";
	}
	return generate(site, data).then(function(token) {
		var p = Promise.resolve();
		var settings = data.settings;
		if (settings) {
			delete settings.grants;
			p = All.settings.save(site, {
				email: data.email,
				data: settings
			});
		}
		return p.then(function() {
			return token;
		});
	}).then(function(token) {
		var mail = {
			from: {
				address: `help@${All.opt.mail.domain}`,
				name: site.data.title
			},
			to: {
				address: data.email
			}
		};
		var tokenStr = token.toString().replace(/\B(?=(\d{2})+(?!\d))/g, " ");
		var prefix = site.data.title ? site.data.title + ' - ' : '';
		if (site.data.lang == "fr") {
			mail.subject = `${prefix}code de vérification: ${tokenStr}`;
			mail.text = `${tokenStr}
Ce message est envoyé depuis
${site.href}
et peut être ignoré.`;
		} else {
			mail.subject = `${prefix}Verification token: ${tokenStr}`;
			mail.text = `${tokenStr}
This message is sent from
${site.href}
and can be ignored.`;
		}
		return All.mail.to(mail).then(function() {
			return {};
		});
	});
};
exports.send.schema = {
	title: 'Send token',
	$action: 'write',
	required: ['email'],
	properties: {
		email: {
			title: 'Email',
			type: 'string',
			format: 'email'
		},
		register: {
			title: 'Register',
			description: 'Allow unknown email',
			type: 'boolean',
			default: false
		},
		settings: {
			title: 'Settings',
			description: 'Default user settings',
			type: 'object'
		}
	}
};
exports.send.external = true;


function verifyToken(email, token) {
	return All.api.transaction(function(trx) {
		return All.user.get({email: [email]}).then(function(user) {
			return userPriv(user, trx).then(function(priv) {
				var tries = (priv.data.otp.tries || 0) + 1;
				if (tries >= 3) {
					var at = Date.parse(priv.data.otp.checked_at);
					if (!isNaN(at) && Date.now() - at < 1000 * otp.options.step / 2) {
						throw new HttpError.TooManyRequests();
					}
				}
				token = token.replace(/\s/g, '');
				var verified = otp.check(token, priv.data.otp.secret);
				return priv.$query(trx).patch({
					'data:otp.checked_at': new Date().toISOString(),
					'data:otp.tries': verified ? 0 : tries
				}).then(function() {
					return verified;
				});
			});
		});
	});
}

exports.grant = function(site, data) {
	return verifyToken(data.email, data.token).then(function(verified) {
		if (!verified) throw new HttpError.BadRequest("Bad token");
		return All.run('settings.find', site, {
			email: data.email
		}).then(function(settings) {
			var userGrants = settings.data && settings.data.grants || [];
			if (userGrants.length == 0) userGrants.push('user'); // the minimum grant
			var userScopes = {};
			userGrants.forEach(function(g) {
				userScopes[g] = true;
			});
			if (All.auth.locked(site, {scopes: userScopes}, [data.grant])) {
				throw new HttpError.Forbidden("User has insufficient grants");
			}
			var scopes = {};
			scopes[data.grant] = true;
			return {
				grants: scopes,
				item: settings,
				cookies: {
					bearer: {
						value: All.auth.sign(site, {
							id: settings.id,
							scopes: scopes
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
	required: ['email', 'token', 'grant'],
	properties: {
		email: {
			title: 'Email',
			type: 'string',
			format: 'email'
		},
		token: {
			title: 'Token',
			type: 'string',
			pattern: '^[\\s\\d]{1,10}$'
		},
		grant: {
			title: 'Grant',
			type: 'string',
			format: 'id',
			$filter: {
				name: 'schema',
				path: 'settings.properties.grants.items'
			}
		}
	}
};

exports.grant.external = true;

exports.link = function(site, data) {
	return generate(site, data).then(function(token) {
		return URL.format({
			pathname: "/.api/login",
			query: {
				email: data.email,
				grant: 'webmaster',
				token: token
			}
		});
	});
};
exports.link.schema = {
	title: 'Internal login link',
	$action: 'write',
	required: ['email', 'grant'],
	properties: {
		email: {
			title: 'Email',
			type: 'string',
			format: 'email'
		},
		grant: {
			title: 'Grant',
			type: 'string',
			format: 'id'
		},
		register: {
			title: 'Register',
			description: 'Allow unknown email',
			type: 'boolean',
			default: false
		}
	}
};


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
