const NodeMailer = require.lazy('nodemailer');
const AddressParser = require.lazy('addressparser');
const Transports = {
	mailgun: require.lazy('nodemailer-mailgun-transport'),
	postmark: require.lazy('nodemailer-postmark-transport')
};
const Mailers = {};

const got = require.lazy('got');

const multipart = require.lazy('./lib/multipart.js');
const validateMailgun = require.lazy('./lib/validate-mailgun.js');

exports = module.exports = function(opt) {
	if (!opt.mail) return;
	Object.entries(opt.mail).forEach(([purpose, conf]) => {
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

	return {
		name: 'mail',
		service: init
	};
};

function init(All) {
	Object.entries(All.opt.mail).forEach(([purpose, conf]) => {
		Log.mail(purpose, conf);
		Mailers[purpose] = {
			transport: NodeMailer.createTransport(Transports[conf.transport]({auth: conf.auth})),
			auth: conf.auth,
			domain: conf.domain,
			sender: AddressParser(conf.sender)[0]
		};
	});

	All.app.post('/.api/mail/receive', multipart, function(req, res, next) {
		All.run('mail.receive', req, req.body).then(function(ok) {
			// https://documentation.mailgun.com/en/latest/user_manual.html#receiving-messages-via-http-through-a-forward-action
			if (!ok) res.sendStatus(406);
			else res.sendStatus(200);
		}).catch(next);
	});
	All.app.post('/.api/mail/report', function(req, res, next) {
		All.run('mail.report', req, req.body).then(function(ok) {
			// https://documentation.mailgun.com/en/latest/user_manual.html#webhooks
			if (!ok) res.sendStatus(406);
			else res.sendStatus(200);
		}).catch(next);
	});
}

exports.report = function(req, data) {
	var mailer = Mailers.bulk;
	var sign = data.signature;
	if (!validateMailgun(mailer.auth, sign.timestamp, sign.token, sign.signature)) {
		return false;
	}
	var event = data['event-data'];
	return All.run('mail.to', req, {
		to: [mailer.sender],
		subject: 'Pageboard mail delivery failure to ' + event.message.headers.to,
		text: JSON.stringify(event, null, ' ')
	});
};
exports.report.schema = {
	$action: 'write',
	additionalProperties: true
};

exports.receive = function(req, data) {
	var mailer = Mailers.bulk;
	if (!validateMailgun(mailer.auth, data.timestamp, data.token, data.signature)) {
		return false;
	}
	var senders = data.sender || '';
	if (data.from) senders += ', ' + data.from;
	senders = AddressParser(senders).map(function(item) { return item.address; });
	if (senders.length == 0) {
		console.error('no senders', data.sender, data.from);
		return false;
	}
	return Promise.all(AddressParser(data.recipient).map(function(item) {
		var parts = item.address.split('@');
		if (parts.pop() != mailer.domain) return false;
		parts = parts[0].split('.');
		if (parts.length != 2) return false;
		return All.run('site.get', req, {id: parts[0]}).then(function(site) {
			req.site = site;
			return Promise.all(All.run('settings.search', req, {
				email: senders
			}), All.run('settings.get', req, {id: parts[1]})).then(function([senders, settings]) {
				if (senders.length == 0) throw new HttpError.NotFound("No known sender");
				return All.run('mail.to', req, {
					from: {
						name: site.data.title,
						address: `${site.id}.${senders[0].id}@${mailer.domain}`
					},
					to: {
						name: settings.data.name || undefined,
						address: settings.parent.data.email
					},
					subject: data.subject,
					html: data['stripped-html'],
					text: data['stripped-text']
				});
			}).catch(function(err) {
				if (err.status == 404) return false;
				else throw err;
			});
		});
	})).then(function(arr) {
		return arr.some(ok => !!ok);
	}).catch(function(err) {
		if (err.status == 404) return false;
		else throw err;
	});
};
exports.receive.schema = {
	$action: 'write',
	additionalProperties: true
};

exports.to = function(req, data) {
	var purpose = data.purpose;
	data = Object.assign({}, data);
	delete data.purpose;
	var mailer = Mailers[purpose];
	if (!mailer) throw new Error("Unknown mailer purpose " + purpose);
	if (data.to.length > 1) {
		if (purpose == "transactional") {
			throw new Error("Transactional mail only accepts one recipient");
		} else {
			data.bcc = data.to;
			data.to = data.replyTo || data.from || mailer.sender;
		}
	}
	var sender = Object.assign({}, data.from || mailer.sender);
	if (!sender.address) {
		sender.address = mailer.sender.address;
	}
	if (data.replyTo) {
		sender.name = data.replyTo.name || data.replyTo.address;
		if (!data.replyTo.address) delete data.replyTo;
	}
	data.from = sender;
	Log.mail("mail.to", data);
	return mailer.transport.sendMail(data);
};
exports.to.schema = {
	$action: 'write',
	required: ['subject', 'to', 'text'],
	properties: {
		purpose: {
			title: 'Purpose',
			anyOf: [{
				title: "Transactional",
				const: "transactional"
			}, {
				title: "Bulk",
				const: "bulk"
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

exports.send = function(req, data) {
	var purpose = data.purpose;
	data = Object.assign({}, data);
	delete data.purpose;
	const mailer = Mailers[purpose];
	if (!mailer) throw new Error("Unknown mailer purpose " + purpose);

	var list = [All.run('block.find', req, {
		type: 'mail',
		data: {url: data.url}
	})];
	var mailOpts = {
		purpose: purpose
	};
	if (data.from) {
		if (data.from.indexOf('@') > 0) {
			list.push(All.run('settings.find', req, {email: data.from}));
		} else {
			list.push(All.run('settings.get', req, {id: data.from}));
		}
	}
	if (data.replyTo) {
		if (data.replyTo.indexOf('@') > 0) {
			mailOpts.replyTo = AddressParser(data.replyTo);
		} else {
			list.push(All.run('settings.get', req, {
				id: data.replyTo
			}).then((settings) => {
				mailOpts.replyTo = {
					address: settings.parent.data.email
				};
			}));
		}
	}

	list.push(Promise.all(data.to.map(function(to) {
		if (to.indexOf('@') > 0) return All.run('settings.save', req, {email: to});
		else return All.run('settings.get', req, {id:to});
	})));

	var site = req.site;

	return Promise.all(list).then(function(rows) {
		var emailPage = rows[0].item;
		if (data.from) mailOpts.from = {
			name: site.data.title,
			address: `${site.id}.${rows[1].id}@${mailer.domain}`
		};
		mailOpts.to = rows.slice(-1).pop().map((settings) => {
			return {
				address: settings.parent.data.email
			};
		});
		var emailUrl = site.href + emailPage.data.url;

		return got(emailUrl + ".mail", { // TODO when all 0.7 are migrated, drop .mail
			headers: {
				cookie: req.get('cookie')
			},
			query: data.body,
			retry: 0,
			timeout: 10000
		}).then(function(response) {
			return JSON.parse(response.body);
		}).then(function(obj) {
			mailOpts.subject = data.subject || obj.title;
			mailOpts.html = obj.html;
			mailOpts.text = obj.text;
			// mailOpts.attachments = [{
			// 	path: '/path/to/test.txt',
			// 	filename: 'test.txt', // optional
			// 	contentType: 'text/plain' // optional
			// }];
			return All.run('mail.to', req, mailOpts);
		});
	});
};
exports.send.schema = {
	title: 'Send email',
	$action: 'write',
	required: ['url', 'to'],
	properties: {
		purpose: {
			title: 'Purpose',
			anyOf: [{
				title: "Transactional",
				const: "transactional"
			}, {
				title: "Bulk",
				const: "bulk"
			}],
			default: 'transactional'
		},
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
			title: 'Body',
			type: 'object'
		}
	}
};
exports.send.external = true;

