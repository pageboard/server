const NodeMailer = require.lazy('nodemailer');
const AddressParser = require.lazy('addressparser');
const Transports = {
	postmark: require.lazy('nodemailer-postmark-transport')
};
const Mailers = {};

const multipart = require.lazy('./lib/multipart.js');

module.exports = class MailModule {
	static name = 'mail';
	constructor(app, opts) {
		this.opts = opts;

		Object.entries(opts).forEach(([purpose, conf]) => {
			if (!Transports[conf.transport]) {
				console.warn("mail transport not supported", purpose, conf.transport);
				return;
			}
			if (!conf.domain) {
				console.warn("mail domain must be set", purpose);
				return;
			}
			if (!conf.sender) {
				console.warn("mail sender must be set", purpose);
				return;
			}
			if (!conf.auth) {
				console.warn("mail auth be set", purpose);
				return;
			}
		});
	}
	apiRoutes(app, server) {
		Object.entries(this.opts).forEach(([purpose, conf]) => {
			Log.mail(purpose, conf);
			try {
				Mailers[purpose] = {
					...conf,
					transport: NodeMailer.createTransport(Transports[conf.transport]({
						auth: conf.auth
					})),
					sender: AddressParser(conf.sender)[0]
				};
			} catch (ex) {
				console.error(ex);
			}
		});
		server.post('/.api/mail/receive', multipart, (req, res, next) => {
			req.run('mail.receive', req.body).then(ok => {
				// https://documentation.mailgun.com/en/latest/user_manual.html#receiving-messages-via-http-through-a-forward-action
				if (!ok) res.sendStatus(406);
				else res.sendStatus(200);
			}).catch(next);
		});
		server.post('/.api/mail/report', (req, res, next) => {
			req.run('mail.report', req.body).then(ok => {
				// https://documentation.mailgun.com/en/latest/user_manual.html#webhooks
				if (!ok) res.sendStatus(406);
				else res.sendStatus(200);
			}).catch(next);
		});
	}

	async report(req, data) {
		const mailer = Mailers.bulk;
		const sign = data.signature;
		if (!checkMail(mailer.auth, sign.timestamp, sign.token, sign.signature)) {
			return false;
		}
		const event = data['event-data'];
		return req.run('mail.to', {
			to: [mailer.sender],
			subject: 'Pageboard mail delivery failure to ' + event.message.headers.to,
			text: JSON.stringify(event, null, ' ')
		});
	}
	static report = {
		$action: 'write',
		additionalProperties: true
	};

	async receive(req, data) {
		const mailer = Mailers.bulk;
		if (!checkMail(mailer.auth, data.timestamp, data.token, data.signature)) {
			return false;
		}
		let senders = data.sender || '';
		if (data.from) senders += ', ' + data.from;
		senders = AddressParser(senders).map(item => item.address);
		if (senders.length == 0) {
			console.error('no senders', data.sender, data.from);
			return false;
		}
		const checks = await Promise.all(AddressParser(data.recipient).map(async item => {
			let parts = item.address.split('@');
			if (parts.pop() != mailer.domain) return false;
			parts = parts[0].split('.');
			if (parts.length != 2) return false;
			const site = await req.run('site.get', { id: parts[0] });
			req.site = site;
			try {
				const [fromSettings, toSettings] = await Promise.all([
					req.run('settings.find', { email: senders }),
					req.run('settings.get', { id: parts[1] })
				]);

				await req.run('mail.to', {
					from: {
						name: site.data.title,
						address: `${site.id}.${fromSettings.id}@${mailer.domain}`
					},
					to: {
						name: toSettings.data.name || undefined,
						address: toSettings.parent.data.email
					},
					subject: data.subject,
					html: data['stripped-html'],
					text: data['stripped-text']
				});
			} catch (err) {
				if (err.status == 404) return false;
				else throw err;
			}
		}));
		return checks.some(ok => Boolean(ok));
	}
	static receive = {
		$action: 'write',
		additionalProperties: true
	};

	async to(req, data) {
		const purpose = data.purpose;
		data = { ...data };
		delete data.purpose;
		const mailer = Mailers[purpose];
		if (!mailer) throw new Error("Unknown mailer purpose " + purpose);
		if (data.to.length > 1) {
			data.bcc = data.to;
			data.to = data.replyTo || data.from || mailer.sender;
		}
		const sender = { ...(data.from ?? mailer.sender) };
		if (!sender.address) {
			sender.address = mailer.sender.address;
		}
		if (data.replyTo) {
			sender.name = data.replyTo.name || data.replyTo.address;
			if (!data.replyTo.address) delete data.replyTo;
		}
		data.from = sender;
		data.headers = { ...mailer.headers };
		if (req.site.id) {
			data.headers["X-PM-Tag"] = req.site.id;
		}
		if (data.attachments) data.attachments = data.attachments.filter(obj => {
			const url = new URL(obj.href, req.site.url);
			return url.host == req.site.url.host;
		});
		Log.mail("mail.to", data);
		return mailer.transport.sendMail(data).then(sentStatus => {
			return {
				accepted: sentStatus.accepted.length > 0,
				rejected: sentStatus.rejected.length > 0
			};
		}).catch(err => {
			err.statusCode = 400;
			throw err;
		});
	}
	static to = {
		$action: 'write',
		required: ['subject', 'to', 'text'],
		properties: {
			purpose: {
				title: 'Purpose',
				anyOf: [{
					title: "Transactional",
					const: "transactional"
				}, {
					title: "Conversations",
					const: "conversations"
				}, {
					title: "Subscriptions",
					const: "subscriptions"
				}],
				default: 'transactional'
			},
			subject: {
				title: 'Subject',
				type: 'string'
			},
			text: {
				title: 'Text body',
				type: 'string'
			},
			html: {
				title: 'HTML body',
				type: 'string'
			},
			attachments: {
				title: 'Attachments',
				description: 'List of URL',
				type: 'array',
				items: {
					type: 'object',
					properties: {
						filename: {
							title: 'File name',
							type: 'string'
						},
						href: {
							title: 'url',
							type: 'string',
							format: 'uri-reference'
						}
					}
				},
				nullable: true
			},
			from: {
				title: 'Sender',
				type: 'object',
				properties: {
					name: {
						title: 'Name',
						type: 'string',
						format: 'singleline',
						nullable: true
					},
					address: {
						title: 'Address',
						type: 'string',
						format: 'email',
						nullable: true
					}
				},
				nullable: true
			},
			replyTo: {
				title: 'Reply to',
				type: 'object',
				properties: {
					name: {
						title: 'Name',
						type: 'string',
						format: 'singleline',
						nullable: true
					},
					address: {
						title: 'Address',
						type: 'string',
						format: 'email',
						nullable: true
					}
				},
				nullable: true
			},
			to: {
				title: 'Recipients',
				type: 'array',
				items: {
					type: 'object',
					properties: {
						name: {
							title: 'Name',
							type: 'string',
							format: 'singleline',
							nullable: true
						},
						address: {
							title: 'Address',
							type: 'string',
							format: 'email'
						}
					}
				}
			}
		}
	};

	async send(req, data) {
		if (!data.from && !data.replyTo) {
			throw new HttpError.NotFound("Missing parameters");
		}
		const { site } = req;
		const purpose = data.purpose;
		data = { ...data };
		delete data.purpose;
		const mailer = Mailers[purpose];
		if (!mailer) {
			throw new Error("Unknown mailer purpose " + purpose);
		}

		const list = [req.run('block.find', {
			type: 'mail',
			data: { url: data.url }
		})];
		const mailOpts = {
			purpose: purpose
		};
		if (data.from) {
			if (data.from.indexOf('@') > 0) {
				list.push(req.run('settings.find', { email: data.from }));
			} else {
				list.push(req.run('settings.get', { id: data.from }));
			}
		}
		if (data.replyTo) {
			if (data.replyTo.indexOf('@') > 0) {
				mailOpts.replyTo = AddressParser(data.replyTo);
			} else {
				list.push(req.run('settings.get', {
					id: data.replyTo
				}).then(settings => {
					mailOpts.replyTo = {
						address: settings.parent.data.email
					};
				}));
			}
		}

		list.push(Promise.all(data.to.map(to => {
			if (to.indexOf('@') > 0) {
				return req.run('settings.save', { email: to });
			} else {
				return req.run('settings.get', { id: to });
			}
		})));

		const results = await Promise.allSettled(list);
		const rows = results.map(item => {
			if (item.status == "rejected") throw item.reason;
			return item.value;
		});
		const emailPage = rows[0].item;
		if (data.from) mailOpts.from = {
			name: site.data.title,
			address: `${site.id}.${rows[1].id}@${mailer.domain}`
		};
		const domains = {};
		mailOpts.to = rows.slice(-1).pop().map(settings => {
			const email = settings.parent.data.email;
			const parsedAddress = AddressParser(email)[0];
			domains[parsedAddress.address.split('@').pop()] = true;
			return {
				address: email
			};
		});
		if (purpose == "transactional" && (Object.keys(domains).length > 2 || mailOpts.to.length > 10)) {
			throw new Error("Transactional mail allowed for at most two different recipients domains and ten recipients");
		}
		const emailUrl = new URL(emailPage.data.url, site.url);
		try {
			// TODO when all 0.7 are migrated, drop .mail extension
			for (const [key, val] of Object.entries(data.body)) {
				if (Array.isArray(val)) for (const sval of val) {
					emailUrl.searchParams.append(key, sval);
				} else {
					emailUrl.searchParams.append(key, val);
				}
			}
			emailUrl.pathname += '.mail';
			const controller = new AbortController();
			const toId = setTimeout(() => controller.abort(), 10000);
			const response = await fetch(emailUrl, {
				headers: {
					cookie: req.get('cookie')
				},
				signal: controller.signal
			});
			clearTimeout(toId);

			const mailObj = await response.json();
			mailOpts.subject = data.subject || mailObj.title;
			mailOpts.html = mailObj.html;
			mailOpts.text = mailObj.text;
			mailOpts.attachments = mailObj.attachments;
		} catch (err) {
			if (err && err.response && err.response.statusCode) {
				throw new HttpError[err.response.statusCode];
			} else {
				throw err;
			}
		}
		return req.run('mail.to', mailOpts);
	}
	static send = {
		title: 'Send email',
		external: true,
		$action: 'write',
		required: ['url', 'to'],
		properties: {
			purpose: this.to.properties.purpose,
			from: {
				title: 'From',
				description: 'User settings.id or email',
				anyOf: [{
					type: 'string',
					format: 'id'
				}, {
					type: 'string',
					format: 'email'
				}]
			},
			replyTo: {
				title: 'Reply To',
				description: 'Email address or user id',
				anyOf: [{
					type: 'string',
					format: 'id'
				}, {
					type: 'string',
					format: 'email'
				}]
			},
			to: {
				title: 'To',
				description: 'List of email addresses or users id',
				type: 'array',
				items: {anyOf: [{
					type: 'string',
					format: 'id'
				}, {
					type: 'string',
					format: 'email'
				}]}
			},
			url: {
				title: 'Mail page',
				type: "string",
				format: "pathname",
				$helper: {
					name: 'page',
					type: 'mail'
				}
			},
			subject: {
				title: 'Subject',
				description: 'Defaults to mail page title',
				type: 'string',
				nullable: true
			},
			body: {
				title: 'Query',
				type: 'object',
				default: {}
			}
		}
	};
};


function checkMail() {
	throw new Error("TODO checkMail");
}
