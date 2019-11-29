const NodeMailer = require.lazy('nodemailer');
const AddressParser = require.lazy('nodemailer/lib/addressparser');
const Mailgun = require.lazy('nodemailer-mailgun-transport');
const got = require.lazy('got');

// TODO https://nodemailer.com/dkim/
// TODO https://postmarkapp.com/blog/differences-in-delivery-between-transactional-and-bulk-email
// use a different domain for transactional and for bulk sending

const multipart = require.lazy('./lib/multipart.js');
const validateMailgun = require.lazy('./lib/validate-mailgun.js');

var mailer, defaultSender, mailDomain;

exports = module.exports = function(opt) {
	/*
	opt.mail.transport
	opt.mail.mailgun contains options auth.api_key, auth.domain
	opt.mail.domain (the same as auth.domain but could be different)
	opt.mail.sender (the name of default sender)
	*/
	// TODO support available transports (SMTP, sendmail, SES)
	if (!opt.mail) return; // quietly return
	if (!opt.mail.domain) {
		console.warn('Missing mail.domain');
		return;
	}
	if (opt.mail.transport != 'mailgun') {
		console.warn("Only `mail.transport: mailgun` is supported");
		return;
	}
	if (!opt.mail.sender) {
		console.warn('Missing mail.sender');
		return;
	}

	return {
		name: 'mail',
		service: init
	};
};

function init(All) {
	const opt = All.opt.mail;
	mailer = NodeMailer.createTransport(Mailgun(opt.mailgun));
	defaultSender = opt.sender;
	mailDomain = opt.domain;

	All.app.post('/.api/mail/receive', multipart, function(req, res, next) {
		All.run('mail.receive', req, req.body).then(function(ok) {
			// https://documentation.mailgun.com/en/latest/user_manual.html#receiving-messages-via-http-through-a-forward-action
			if (!ok) res.sendStatus(406);
			else res.sendStatus(200);
		}).catch(next);
	});
	All.app.post('/.api/mail/event', function(req, res, next) {
		All.run('mail.event', req, req.body).then(function(ok) {
			// https://documentation.mailgun.com/en/latest/user_manual.html#webhooks
			if (!ok) res.sendStatus(406);
			else res.sendStatus(200);
		});
	});
}

exports.event = function(req, data) {
	if (!validateMailgun(All.opt.mail.mailgun, data.timestamp, data.token, data.signature)) {
		return false;
	}
	var event = data['event-data'];
	return All.run('mail.to', req, {
		to: [defaultSender],
		subject: 'Pageboard mail delivery failure to ' + event.message.headers.to,
		text: JSON.stringify(event, null, ' ')
	});
};

exports.receive = function(req, data) {
	if (!validateMailgun(All.opt.mail.mailgun, data.timestamp, data.token, data.signature)) {
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
		if (parts.pop() != mailDomain) return false;
		parts = parts[0].split('.');
		if (parts.length != 2) return false;
		return All.run('site.get', req, {id: parts[0]}).then(function(site) {
			req.site = site;
			return Promise.all(All.run('settings.search', req, {
				email: senders
			}), All.run('settings.get', req, {id: parts[1]})).then(function([senders, settings]) {
				if (senders.length == 0) throw new HttpError.NotFound("No known sender");
				return exports.to(req, {
					from: {
						name: site.data.title,
						address: `${site.id}.${senders[0].id}@${mailDomain}`
					},
					to: {
						name: settings.data.name || undefined,
						address: settings.user.data.email
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

exports.to = function(req, data) {
	if (!data.from) data.from = defaultSender;
	return mailer.sendMail(data);
};
exports.to.schema = {
	$action: 'write',
	required: ['subject', 'to', 'text'],
	properties: {
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
			title: 'Sender email',
			type: 'string',
			format: 'email',
			transform: ['trim']
		},
		replyTo: {
			title: 'Reply to',
			type: 'string',
			format: 'email',
			transform: ['trim'],
			nullable: true
		},
		to: {
			title: 'Recipients emails',
			type: 'array',
			items: {
				type: 'string',
				format: 'email',
				transform: ['trim']
			}
		}
	}
};

exports.send = function(req, data) {
	var list = [All.run('block.find', req, {
		type: 'mail',
		data: {url: data.url}
	})];
	var mailOpts = {
		from: defaultSender
	};
	if (data.replyTo) mailOpts.replyTo = data.replyTo;
	if (data.from) {
		var p;
		if (data.from.indexOf('@') > 0) {
			p = All.run('settings.find', req, {email: data.from});
		} else {
			p = All.run('settings.get', req, {id: data.from});
		}
		list.push(p.then(function(settings) {
			return settings.id;
		}));
	}
	list.push(Promise.all(data.to.map(function(to) {
		if (to.indexOf('@') > 0) return All.run('settings.find', req, {email:to}).then(function(settings) {
			return settings.email;
		});
		else return All.run('settings.get', req, {id:to}).then(function(settings) {
			return settings.user.data.email;
		});
	})));

	var site = req.site;
	return Promise.all(list).then(function(rows) {
		var emailPage = rows[0].item;
		if (data.from) mailOpts.from = {
			name: site.data.title,
			address: `${site.id}.${rows[1]}@${mailDomain}`
		};
		mailOpts.to = rows.slice(-1).pop();
		var emailUrl = site.href + emailPage.data.url;

		return got(emailUrl + ".mail", {
			headers: {
				cookie: req.get('cookie')
			},
			query: data.body,
			retry: 0,
			timeout: 10000
		}).then(function(response) {
			return JSON.parse(response.body);
		}).then(function(obj) {
			mailOpts.subject = obj.title;
			mailOpts.html = obj.html;
			mailOpts.text = obj.text;
			// mailOpts.attachments = [{
			// 	path: '/path/to/test.txt',
			// 	filename: 'test.txt', // optional
			// 	contentType: 'text/plain' // optional
			// }];
			return exports.to(req, mailOpts);
		});
	});
};
exports.send.schema = {
	title: 'Send email',
	$action: 'write',
	required: ['url', 'to'],
	properties: {
		url: {
			title: 'Mail page',
			type: "string",
			format: "pathname",
			$helper: {
				name: 'page',
				type: 'mail'
			}
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
			description: 'Any email address',
			type: 'string',
			format: 'email'
		},
		to: {
			title: 'To',
			description: 'List of users (settings.id or email)',
			type: 'array',
			items: {anyOf: [{
				type: 'string',
				format: 'id'
			}, {
				type: 'string',
				format: 'email'
			}]}
		},
		body: {
			title: 'Body',
			type: 'object'
		}
	}
};
exports.send.external = true;
