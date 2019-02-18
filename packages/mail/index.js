var NodeMailer = require('nodemailer');
var AddressParser = require('nodemailer/lib/addressparser');
var Mailgun = require('nodemailer-mailgun-transport');
var got = require('got');

// TODO https://nodemailer.com/dkim/
// TODO https://postmarkapp.com/blog/differences-in-delivery-between-transactional-and-bulk-email
// use a different domain for transactional and for bulk sending

var multipart = require('./lib/multipart.js');
var mailPlugin = require('./lib/express-dom-email');
var validateMailgun = require('./lib/validate-mailgun.js');

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
	mailer = NodeMailer.createTransport(Mailgun(opt.mail.mailgun));
	defaultSender = opt.mail.sender;
	mailDomain = opt.mail.domain;

	return {
		priority: -10, // because default prerendering happens at 0
		name: 'mail',
		service: function(All) {
			All.app.post('/.api/mail', multipart, function(req, res, next) {
				All.run('mail.receive', req.body).then(function(ok) {
					// https://documentation.mailgun.com/en/latest/user_manual.html#receiving-messages-via-http-through-a-forward-action
					if (!ok) res.sendStatus(406);
					else res.sendStatus(200);
				}).catch(next);
			});
			All.opt.extnames.push('mail');
			All.dom.settings.helpers.unshift(mailPlugin);
		}
	};
};

exports.receive = function(data) {
	// https://documentation.mailgun.com/en/latest/user_manual.html#parsed-messages-parameters
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
		return All.run('site.get', {id: parts[0]}).then(function(site) {
			return Promise.all(All.run('settings.find', site, {
				email: senders
			}), All.run('settings.get', site, {id: parts[1]})).then(function([sender, settings]) {
				return exports.to({
					from: {
						name: site.data.title,
						address: `${site.id}.${sender.id}@${mailDomain}`
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

exports.to = function(data) {
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

exports.send = function(site, data) {
	var list = [All.run('block.find', site, {
		type: 'mail',
		data: {url: data.url}
	})];
	if (data.from) {
		var p;
		if (data.from.indexOf('@') > 0) p = All.run('settings.find', site, {email: data.from});
		else p = All.run('settings.get', site, {id: data.from});
		list.push(p.then(function(settings) {
			return settings.id;
		}));
	}
	list.push(Promise.all(data.to.map(function(to) {
		if (to.indexOf('@') > 0) return All.run('settings.find', site, {email:to}).then(function(settings) {
			return settings.email;
		});
		else return All.run('settings.get', site, {id:to}).then(function(settings) {
			return settings.user.data.email;
		});
	})));

	return Promise.all(list).then(function(rows) {
		var emailPage = rows[0].item;
		var from = defaultSender;
		if (data.from) from = {
			name: site.data.title,
			address: `${site.id}.${rows[1]}@${mailDomain}`
		};
		var emailUrl = site.href + emailPage.data.url;

		return got(emailUrl + ".mail", {
			query: data.body,
			retry: 0,
			timeout: 10000
		}).then(function(response) {
			return JSON.parse(response.body);
		}).then(function(obj) {
			var mail = {
				from: from,
				to: rows.slice(-1).pop(),
				subject: obj.title,
				html: obj.html,
				text: obj.text,
//				attachments: [{
//					path: '/path/to/test.txt',
//					filename: 'test.txt', // optional
//					contentType: 'text/plain' // optional
//				}]
			};
			if (data.replyTo) mail.replyTo = data.replyTo;
			return exports.to(mail);
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
			title: 'Sender',
			description: 'settings.id or email',
			anyOf: [{
				type: 'string',
				format: 'id'
			}, {
				type: 'string',
				format: 'email'
			}]
		},
		to: {
			title: 'Recipients',
			description: 'list of settings.id or email',
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
