const otp = require.lazy('otplib');
const qrcode = require.lazy('qrcode');

module.exports = class LoginModule {
	static name = 'login';

	constructor(app, opts) {
		this.app = app;
	}
	apiRoutes(app, server) {
		otp.authenticator.options = {
			step: 30, // do not change this value, we want third-party otp apps to work with us
			window: [40, 1] // ten minutes-old tokens are still valid
		};
		server.get("/.api/login", async (req, res) => {
			const data = await req.run('login.grant', req.query);
			res.return(data);
		});

		server.get("/.api/logout", async (req, res) => {
			const data = await req.run('login.clear', req.query);
			res.return(data);
		});
	}

	async #userPriv({ trx }, user) {
		try {
			return await user.$relatedQuery('children', trx).alias('privs')
				.where('privs.type', 'priv')
				.first().throwIfNotFound().select();
		} catch (err) {
			if (err.statusCode != 404) throw err;
			return user.$relatedQuery('children', trx).insert({
				type: 'priv',
				data: {
					otp: {
						secret: otp.authenticator.generateSecret()
					}
				}
			}).returning('*');
		}
	}

	async #generate(req, data) {
		if (data.register) await req.run('user.add', {
			email: data.email
		});
		const user = await req.run('user.get', {
			email: data.email
		});
		const priv = await this.#userPriv(req, user);
		return otp.authenticator.generate(priv.data.otp.secret);
	}

	async send(req, data) {
		const { site } = req;
		if (!site.url) {
			return "login.send requires a hostname. Use login.link";
		}
		const token = await this.#generate(req, data);
		const settings = data.settings || {};
		delete settings.grants;
		await req.run('settings.save', {
			email: data.email,
			data: settings
		});
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
				${site.url.href}
				et peut être ignoré.`;
		} else {
			mail.subject = `${prefix}verification token: ${tokenStr}`;
			mail.text = Text`
				${tokenStr}
				This message is sent from
				${site.url.href}
				and can be ignored.`;
		}
		await req.run('mail.to', mail);
		return {};
	}
	static send = {
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
	async #verifyToken(req, { email, token }) {
		const { trx } = req;
		const user = await req.run('user.get', { email });
		const priv = await this.#userPriv(req, user);
		const tries = (priv.data.otp.tries || 0) + 1;
		if (tries >= 5) {
			const at = Date.parse(priv.data.otp.checked_at);
			if (!Number.isNaN(at) && (Date.now() - at < 1000 * otp.authenticator.options.step / 2)) {
				throw new HttpError.TooManyRequests();
			}
		}
		token = token.replaceAll(/\s/g, '');
		const verified = otp.authenticator.check(token, priv.data.otp.secret);
		await priv.$query(trx).patchObject({
			type: priv.type,
			data: {
				otp: {
					checked_at: new Date().toISOString(),
					tries: verified ? 0 : tries
				}
			}
		});
		return verified;
	}

	async grant(req, data) {
		const { user = {} } = req;
		const verified = await this.#verifyToken(req, data);
		if (!verified) throw new HttpError.BadRequest("Bad token");
		const settings = await req.run('settings.find', {
			email: data.email
		});
		const prevGrants = user?.grants ?? [];
		req.user = Object.assign(user, {
			id: settings.id,
			grants: settings.data?.grants ?? []
		});
		if (user.grants.length == 0) user.grants.push('user');
		const locks = data.grant ? [data.grant] : [];
		if (req.locked(locks)) {
			throw new HttpError.Forbidden("User has insufficient grants");
		}
		user.grants = locks;
		req.granted = prevGrants.join(',') != user.grants.join(',');
		return {
			item: settings,
			cookies: {
				bearer: await req.run('auth.cookie', data)
			}
		};
	}
	static grant = {
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
				pattern: /^[\s\d]{1,10}$/.source
			},
			grant: {
				title: 'Grant',
				type: 'string',
				format: 'grant',
				nullable: true,
				$filter: {
					name: 'schema',
					path: 'settings.properties.grants.items'
				}
			},
			maxAge: {
				title: 'Max Age',
				description: 'max age of cookie in seconds',
				type: 'integer',
				default: 60 * 60 * 24 * 30
			}
		}
	};

	async link(req, data) {
		const token = await this.#generate(req, data);
		return "/.api/login?" + new URLSearchParams({
			email: data.email,
			grant: 'webmaster',
			token: token
		}).toString();
	}
	static link = {
		title: 'Internal login link',
		$action: 'write',
		required: ['email', 'grant'],
		$lock: true,
		properties: {
			email: {
				title: 'Email',
				type: 'string',
				format: 'email'
			},
			grant: {
				title: 'Grant',
				type: 'string',
				format: 'grant'
			},
			register: {
				title: 'Register',
				description: 'Allow unknown email',
				type: 'boolean',
				default: false
			}
		}
	};

	clear(req, data) {
		req.granted = true;
		return {
			cookies: {
				bearer: {}
			}
		};
	}
	static clear = {
		title: 'Logout',
		description: 'Clear cookie',
		$action: 'write'
	};

	async key(req, data) {
		const user = await req.run('user.get', {
			email: data.email
		});
		const priv = await this.#userPriv(req, user);
		const uri = otp.authenticator.keyuri(
			user.data.email, this.app.name, priv.data.otp.secret
		);
		if (data.qr) {
			if (this.app.opts.cli) {
				return qrcode.toString(uri, {
					type: 'terminal',
					errorCorrectionLevel: 'L'
				});
			} else {
				return {
					item: {
						type: 'qrcode',
						data: {
							url: await qrcode.toDataURL(uri, {
								errorCorrectionLevel: 'L'
							}),
							width: 196,
							height: 196
						}
					}
				};
			}
		} else {
			return uri;
		}
	}
	static key = {
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
};
