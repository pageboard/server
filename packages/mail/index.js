const NodeMailer = require.lazy('nodemailer');
const AddressParser = require.lazy('addressparser');
const Transports = {
	postmark: require.lazy('nodemailer-postmark-transport')
};
const Mailers = {};

module.exports = class MailModule {
	static name = 'mail';
	constructor(app, opts) {
		this.app = app;
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
	}

	async elements() {
		return import('./lib/mail_job.mjs');
	}

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
		title: 'Receive',
		$private: true,
		$action: 'write',
		additionalProperties: true,
		properties: { /* TODO */ }
	};

	async to(req, data) {
		const purpose = data.purpose;
		data = { ...data };
		delete data.purpose;

		const mailer = Mailers[purpose];
		if (!mailer) throw new Error("Unknown mailer purpose " + purpose);

		if (purpose == "transactional" && data.to.length > 5) {
			throw new Error("Transactional mail allowed for at most five recipients");
		}
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
		if (req.site.id) data.tag = req.site.id;
		if (data.attachments) data.attachments = data.attachments.filter(obj => {
			const url = new URL(obj.href, req.site.$url);
			return url.host == req.site.$url.host;
		});
		Log.mail("mail.to", data);
		try {
			const sentStatus = await mailer.transport.sendMail(data);
			return {
				accepted: sentStatus.accepted.length > 0,
				rejected: sentStatus.rejected.length > 0
			};
		} catch(err) {
			err.statusCode = 400;
			throw err;
		}
	}
	static to = {
		title: 'Send to',
		$private: true,
		required: ['subject', 'to', 'text'],
		properties: {
			purpose: {
				$ref: "/elements#/definitions/mail_job/properties/data/properties/purpose"
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

	async #sendJob(req, block) {
		const { site } = req;
		const { data } = block;
		const mailer = Mailers[data.purpose];

		const mailOpts = {
			purpose: data.purpose
		};

		if (data.from) {
			let fromId;
			if (data.from.indexOf('@') > 0) {
				fromId = (await req.run('settings.find', { email: data.from })).item.id;
			} else {
				fromId = (await req.run('settings.get', { id: data.from })).item.id;
			}
			mailOpts.from = {
				title: site.data.title,
				address: `${site.id}.${fromId}@${mailer.domain}`
			};
		}
		if (data.replyTo) {
			if (data.replyTo.indexOf('@') > 0) {
				mailOpts.replyTo = AddressParser(data.replyTo)[0];
			} else {
				mailOpts.replyTo = (await req.run('settings.get', {
					id: data.replyTo
				})).item?.parent?.data?.email;
			}
		}

		mailOpts.to = await Promise.all(data.to.map(async to => {
			let res;
			if (to.indexOf('@') > 0) {
				res = await req.run('settings.have', { email: to });
			} else {
				res = await req.run('settings.get', { id: to });
			}
			const email = res.item?.parent?.data?.email;
			if (!email) throw new HttpError.NotFound("recipient not found: " + to);
			return {
				address: email
			};
		}));

		const emailUrl = req.call('page.format', {
			url: data.url,
			lang: data.lang,
			ext: 'mail'
		});
		const controller = new AbortController();
		const toId = setTimeout(() => controller.abort(), 10000);
		const response = await fetch(emailUrl, {
			redirection: 'error',
			headers: {
				accept: 'application/json',
				cookie: req.get('cookie')
			},
			signal: controller.signal
		});
		clearTimeout(toId);
		if (!response.ok) throw new HttpError.BadRequest(response.statusText);

		const mailObj = await response.json();
		Object.assign(mailOpts, {
			subject: mailObj.title,
			html: mailObj.html,
			text: mailObj.text,
			attachments: mailObj.attachments
		});
		await req.run('mail.to', mailOpts);
	}

	async send(req, data) {
		if (!data.from && !data.replyTo) {
			throw new HttpError.NotFound("Missing parameters: from or replyTo");
		}
		if (!Mailers[data.purpose]) {
			throw new Error("Unknown mailer purpose " + data.purpose);
		}
		const { item: emailPage } = await req.run('block.find', {
			type: 'mail',
			data: {
				url: new URL(data.url, req.site.$url).pathname,
				lang: data.lang
			}
		});
		if (!emailPage) throw new HttpError.NotFound("email page missing");

		const { item: block } = await req.run('block.add', {
			type: 'mail_job',
			data: { ...data, response: {} }
		});
		req.postTry(block, (req, block) => this.#sendJob(req, block));
		return block;
	}
	static send = {
		title: 'Send',
		$action: 'write',
		$ref: "/elements#/definitions/mail_job/properties/data"
	};

	async again(req, data) {
		const block = await req.run('block.get', data);
		await req.try(block, (req, block) => this.#sendJob(req, block));
		return block;
	}
	static again = {
		title: 'Resend',
		$action: 'write',
		required: ['id'],
		properties: {
			id: {
				title: 'id',
				type: 'string',
				format: 'id'
			}
		}
	};
};


function checkMail() {
	throw new Error("TODO checkMail");
}
