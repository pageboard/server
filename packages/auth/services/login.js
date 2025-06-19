// TODO move to https://github.com/hectorm/otpauth
const otp = require.lazy('otplib');
const qrcode = require.lazy('qrcode');

module.exports = class LoginModule {
	static name = 'login';

	constructor(app, opts) {
		this.app = app;
	}
	apiRoutes(router) {
		router.write("/login/send", 'login.send');
		router.write("/login/verify", 'login.verify');
		router.write("/login/clear", 'login.clear');
	}

	#authenticator;
	get #otp() {
		if (!this.#authenticator) {
			this.#authenticator = otp.authenticator;
			this.#authenticator.options = {
				// third-party TOTP apps expect steps of 30 seconds
				step: 30
			};
		}
		return this.#authenticator;
	}

	async priv({ sql: { trx } }, user) {
		try {
			return await user.$relatedQuery('children', trx).alias('privs')
				.where('privs.type', 'priv')
				.first().throwIfNotFound().columns();
		} catch (err) {
			if (err.statusCode != 404) throw err;
			return user.$relatedQuery('children', trx).insert({
				type: 'priv',
				data: {
					otp: {
						secret: this.#otp.generateSecret()
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
		const priv = await this.priv(req, user);
		return this.#otp.generate(priv.data.otp.secret);
	}

	async send(req, data) {
		// TODO most of this should be replaced
		// in particular the email since now it is cheap to generate them
		// the connection logic should also match usual one
		const { site, $url } = req;
		if (!$url) {
			throw new HttpError.BadRequest("login.send requires a hostname. Use login.link");
		}
		const token = await this.#generate(req, data);
		const { item: settings } = await req.run('settings.have', {
			email: data.email
		});
		if (!Object.isEmpty(data.settings)) {
			await req.run('settings.save', { id: settings.id, data: data.settings });
		}
		const mail = {
			purpose: 'transactional',
			to: [{
				address: data.email
			}]
		};
		const tokenStr = token.toString();
		if (req.call('translate.lang').lang == "fr") {
			mail.subject = `Code: ${tokenStr} pour ${site.data.title ?? site.id}`;
			mail.text = Text`
				${tokenStr}

				Ce message est envoyé depuis
				${req.$url.href}

				Si vous n'avez pas demandé ce code, vous pouvez ignorer ce message.`;
		} else {
			mail.subject = `Token: ${tokenStr} for ${site.data.title ?? site.id}`;
			mail.text = Text`
				${tokenStr}

				This message is sent from
				${req.$url.href}

				If you didn't ask this code, you can ignore this message.`;
		}
		await req.run('mail.to', mail);
		return {};
	}
	static send = {
		title: 'Send',
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
	async #verifyToken(req, { email, token, tokenMaxAge }) {
		const { sql: { trx } } = req;
		const user = await req.run('user.get', { email });
		const priv = await this.priv(req, user);
		const tries = (priv.data.otp.tries || 0) + 1;
		if (tries >= 5) {
			const at = Date.parse(priv.data.otp.checked_at);
			if (!Number.isNaN(at) && (Date.now() - at < 1000 * this.#otp.options.step / 2)) {
				throw new HttpError.TooManyRequests();
			}
		}
		token = token.replaceAll(/\s/g, '');
		this.#otp.options = {
			window: [tokenMaxAge, 0],
			step: this.#otp.options.step
		};
		const verified = this.#otp.check(token, priv.data.otp.secret);
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

	async verify(req, data) {
		const { user } = req;
		const verified = await this.#verifyToken(req, data);
		if (!verified) throw new HttpError.BadRequest("Bad token");
		const { item: settings } = await req.call('settings.find', {
			email: data.email
		});
		const { grants } = user;
		user.id = settings.id;
		user.grants = settings.data?.grants ?? [];
		if (user.grants.length == 0) user.grants.push('user');
		if (req.locked(data.grant)) {
			throw new HttpError.Forbidden("User has insufficient grants");
		}
		user.grants = data.grant ?? [];
		req.granted = grants.join(',') != user.grants.join(',');
		return {
			item: settings,
			cookies: {
				bearer: await req.run('auth.bearer', {
					id: user.id,
					grants: user.grants,
					maxAge: data.maxAge
				})
			}
		};
	}
	static verify = {
		title: 'Verify',
		description: 'Check token to get bearer',
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
				title: 'Grants',
				$ref: "/elements#/definitions/settings/properties/data/properties/grants"
			},
			maxAge: {
				title: 'Max Age',
				description: 'max age of cookie in seconds',
				type: 'integer',
				default: 60 * 60 * 24 * 7
			},
			tokenMaxAge: {
				title: 'Token Max Age',
				description: 'in steps of 30 seconds',
				type: 'integer',
				default: 10
			}
		}
	};

	async link(req, data) {
		const token = await this.#generate(req, data);
		return "/@api/login/verify?" + new URLSearchParams({
			email: data.email,
			grant: data.grant,
			token
		}).toString();
	}
	static link = {
		title: 'Internal link',
		$action: 'write',
		required: ['email', 'grant'],
		$private: true,
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
		const priv = await this.priv(req, user);
		const item = {
			type: 'otp',
			data: {
				uri: this.#otp.keyuri(
					user.data.email, this.app.name, priv.data.otp.secret
				)
			}
		};

		if (this.app.opts.cli) {
			return qrcode.toString(item.data.uri, {
				type: 'terminal',
				errorCorrectionLevel: 'L'
			});
		} else {
			return { item };
		}
	}
	static key = {
		title: 'Get otp key',
		$action: 'read',
		required: ['email'],
		properties: {
			email: {
				title: 'Email',
				type: 'string',
				format: 'email'
			}
		}
	};
};
