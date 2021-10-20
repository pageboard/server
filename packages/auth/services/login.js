const otp = require.lazy('otplib');
const qrcode = require.lazy('qrcode');
const URL = require('url');

exports = module.exports = function (opt) {
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
	All.app.get("/.api/login", (req, res, next) => {
		All.run('login.grant', req, req.query).then((data) => {
			All.send(res, data);
		}).catch(next);
	});

	All.app.get("/.api/logout", (req, res, next) => {
		All.run('login.clear', req, req.query).then((data) => {
			All.send(res, data);
		}).catch(next);
	});
}

function userPriv({ trx }, user) {
	return user.$relatedQuery('children', trx).alias('privs')
		.where('privs.type', 'priv')
		.first().throwIfNotFound().select().catch((err) => {
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
	return Promise.resolve().then(() => {
		if (data.register) return All.user.add(req, { email: data.email });
	}).then(() => {
		return All.user.get(req, { email: data.email }).select('_id');
	}).then((user) => {
		return userPriv(req, user);
	}).then((priv) => {
		return otp.authenticator.generate(priv.data.otp.secret);
	});
}

exports.send = function (req, data) {
	const site = req.site;
	if (!site.href) {
		return "login.send requires a hostname. Use login.link";
	}
	return generate(req, data).then((token) => {
		let p = Promise.resolve();
		const settings = data.settings || {};
		delete settings.grants;
		p = All.settings.save(req, {
			email: data.email,
			data: settings
		});
		return p.then(() => {
			return token;
		});
	}).then((token) => {
		const mail = {
			purpose: 'transactional',
			from: {
				name: site.data.title
			},
			to: [{
				address: data.email
			}]
		};
		const tokenStr = token.toString();
		const prefix = site.data.title ? site.data.title + ' - ' : '';
		if (site.data.lang == "fr") {
			mail.subject = `${prefix}code de vérification: ${tokenStr}`;
			mail.text = Text`
				${tokenStr}
				Ce message est envoyé depuis
				${site.href}
				et peut être ignoré.`;
		} else {
			mail.subject = `${prefix}verification token: ${tokenStr}`;
			mail.text = Text`
				${tokenStr}
				This message is sent from
				${site.href}
				and can be ignored.`;
		}
		return All.run('mail.to', req, mail).then(() => {
			// do not return information about that
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


function verifyToken(req, { email, token }) {
	return All.user.get(req, { email }).then((user) => {
		return userPriv(req, user).then((priv) => {
			const tries = (priv.data.otp.tries || 0) + 1;
			if (tries >= 5) {
				const at = Date.parse(priv.data.otp.checked_at);
				if (!Number.isNaN(at) && Date.now() - at < 1000 * otp.authenticator.options.step / 2) {
					throw new HttpError.TooManyRequests();
				}
			}
			token = token.replaceAll(/\s/g, '');
			const verified = otp.authenticator.check(token, priv.data.otp.secret);
			return priv.$query(req.trx).patch({
				'data:otp.checked_at': new Date().toISOString(),
				'data:otp.tries': verified ? 0 : tries
			}).then(() => {
				return verified;
			});
		});
	});
}

exports.grant = function (req, data) {
	return verifyToken(req, data).then((verified) => {
		if (!verified) throw new HttpError.BadRequest("Bad token");
		return All.run('settings.find', req, {
			email: data.email
		}).then((settings) => {
			const grants = req.user && req.user.grants || [];
			const user = req.user = {
				id: settings.id,
				grants: settings.data && settings.data.grants || []
			};
			if (user.grants.length == 0) user.grants.push('user');
			const locks = data.grant ? [data.grant] : [];
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
			format: 'name',
			nullable: true,
			$filter: {
				name: 'schema',
				path: 'settings.properties.grants.items'
			}
		}
	}
};

exports.grant.external = true;

exports.link = function (req, data) {
	return generate(req, data).then((token) => {
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
			format: 'name'
		},
		register: {
			title: 'Register',
			description: 'Allow unknown email',
			type: 'boolean',
			default: false
		}
	}
};


exports.clear = function (req, data) {
	req.granted = true;
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

exports.key = function (req, data) {
	return All.user.get(req, { email: data.email }).then((user) => {
		return userPriv(req, user).then((priv) => {
			const uri = otp.authenticator.keyuri(user.data.email, All.opt.name, priv.data.otp.secret);
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
