const otp = require.lazy('otplib');
const qrcode = require.lazy('qrcode');
const URL = require('url');

exports = module.exports = function(opt) {
	return {
		name: 'login',
		service: init
	};
};

function init(All) {
	otp.authenticator.options = {
		step: 30, // do not change this value, we want third-party otp apps to work with us
		window: [40, 1] // ten minutes-old tokens are still valid
	};
	All.app.get("/.api/login", function(req, res, next) {
		All.run('login.grant', req, req.query).then(function(data) {
			data.location = "back";
			All.send(res, data);
		}).catch(next);
	});

	All.app.get("/.api/logout", function(req, res, next) {
		All.run('login.clear', req, req.query).then(function(data) {
			data.location = "back";
			All.send(res, data);
		}).catch(next);
	});
}

function userPriv({trx}, user) {
	return user.$relatedQuery('children', trx).alias('privs')
	.where('privs.type', 'priv')
	.first().throwIfNotFound().select().catch(function(err) {
		if (err.statusCode != 404) throw err;
		return user.$relatedQuery('children', trx).insert({
			type: 'priv',
			data: {
				otp: {
					secret: otp.authenticator.generateSecret()
				}
			}
		}).returning('*');
	});
}

function generate(req, data) {
	return Promise.resolve().then(function() {
		if (data.register) return All.user.add(req, {email: data.email});
	}).then(function() {
		return All.user.get(req, {email: data.email}).select('_id');
	}).then(function(user) {
		return userPriv(req, user);
	}).then(function(priv) {
		return otp.authenticator.generate(priv.data.otp.secret);
	});
}

exports.send = function(req, data) {
	var site = req.site;
	if (!site.href) {
		return "login.send requires a hostname. Use login.link";
	}
	return generate(req, data).then(function(token) {
		var p = Promise.resolve();
		var settings = data.settings;
		if (settings) {
			delete settings.grants;
			p = All.settings.save(req, {
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
			mail.text = Text`${tokenStr}
				Ce message est envoyé depuis
				${site.href}
				et peut être ignoré.`;
		} else {
			mail.subject = `${prefix}Verification token: ${tokenStr}`;
			mail.text = Text`${tokenStr}
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


function verifyToken(req, {email, token}) {
	return All.user.get(req, {email}).then(function(user) {
		return userPriv({req}, user).then(function(priv) {
			var tries = (priv.data.otp.tries || 0) + 1;
			if (tries >= 5) {
				var at = Date.parse(priv.data.otp.checked_at);
				if (!isNaN(at) && Date.now() - at < 1000 * otp.authenticator.options.step / 2) {
					throw new HttpError.TooManyRequests();
				}
			}
			token = token.replace(/\s/g, '');
			var verified = otp.authenticator.check(token, priv.data.otp.secret);
			return priv.$query(req.trx).patch({
				'data:otp.checked_at': new Date().toISOString(),
				'data:otp.tries': verified ? 0 : tries
			}).then(function() {
				return verified;
			});
		});
	});
}

exports.grant = function(req, data) {
	return verifyToken(req, data).then(function(verified) {
		if (!verified) throw new HttpError.BadRequest("Bad token");
		return All.run('settings.find', req, {
			email: data.email
		}).then(function(settings) {
			var grants = req.user && req.user.grants || [];
			var user = req.user = {
				id: settings.id,
				grants: settings.data && settings.data.grants || []
			};
			if (user.grants.length == 0) user.grants.push('user');
			var locks = data.grant ? [data.grant] : [];
			if (All.auth.locked(req, locks)) {
				throw new HttpError.Forbidden("User has insufficient grants");
			}
			user.grants = locks;
			req.granted = grants.join(',') != locks.join(',');
			return {
				item: settings,
				cookies: {
					bearer: All.auth.cookie(req)
				}
			};
		});
	});
};

exports.grant.schema = {
	title: 'Grant',
	description: 'Sets cookie with grants',
	$action: 'write',
	required: ['email', 'token'],
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
			nullable: true,
			$filter: {
				name: 'schema',
				path: 'settings.properties.grants.items'
			}
		}
	}
};

exports.grant.external = true;

exports.link = function(req, data) {
	return generate(req, data).then(function(token) {
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


exports.clear = function(req, data) {
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

exports.key = function(req, data) {
	return All.user.get(req, {email: data.email}).then(function(user) {
		return userPriv(req, user).then(function(priv) {
			var uri = otp.authenticator.keyuri(user.data.email, All.opt.name, priv.data.otp.secret);
			if (data.qr) {
				return qrcode.toString(uri, {
					type: 'terminal',
					errorCorrectionLevel: 'L'
				});
			} else {
				return uri;
			}
		});
	});
};
exports.key.schema = {
	title: 'Private Key URI',
	$action: 'read',
	required: ['email'],
	properties: {
		email: {
			title: 'Email',
			type: 'string',
			format: 'email'
		},
		qr: {
			title: 'QR Code',
			type: 'boolean',
			default: false
		}
	}
};
