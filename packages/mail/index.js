var NodeMailer = require('nodemailer');
var AddressParser = require('nodemailer/lib/addressparser');
var Mailgun = require('nodemailer-mailgun-transport');
var got = require('got');
var URL = require('url');

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
	return All.run('user.get', {
		email: senders
	}).then(function(sender) {
		return Promise.all(AddressParser(data.recipient).map(function(item) {
			var parts = item.address.split('@');
			if (parts.pop() != mailDomain) return false;
			parts = parts[0].split('.');
			if (parts.length != 2) return false;
			var siteId = parts[0];
			var userId = parts[1];
			return Promise.all([
				All.run('user.get', {id: userId}),
				All.run('site.get', {id: siteId})
			]).then(function([user, site]) {
				return exports.to({
					from: {
						name: site.data.domains[0],
						address: `${site.id}.${sender.id}@${mailDomain}`
					},
					to: {
						name: user.data.name || undefined,
						address: user.data.email
					},
					subject: data.subject,
					html: data['stripped-html'],
					text: data['stripped-text']
				});
			}).catch(function(err) {
				if (err.status == 404) return false;
				else throw err;
			});
		}));
	}).then(function(arr) {
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
	var urlObj = URL.parse(data.url, true);
	var list = [All.run('block.search', site, {
		type: 'mail',
		data: {url: urlObj.pathname}
	})];
	if (data.from) list.push(All.run('user.get', {
		email: data.from
	}));

	return Promise.all(list).then(function(rows) {
		var pages = rows[0];
		var from = defaultSender;
		if (rows.length > 1) from = {
			name: site.data.domains[0],
			address: `${site.id}.${rows[1].id}@${mailDomain}`
		};

		var emailPage = pages.items[0];
		if (!emailPage) throw new HttpError.NotFound("Page not found");
		var emailUrl = site.href + emailPage.data.url;

		return got(emailUrl, {
			query: Object.assign(urlObj.query, {
				email: true
			}),
			retry: 0,
			timeout: 10000
		}).then(function(response) {
			return JSON.parse(response.body);
		}).then(function(obj) {
			var mail = {
				from: from,
				to: data.to,
				subject: obj.title,
				html: obj.html,
				text: obj.text,
//				attachments: [{
//					path: '/path/to/test.txt',
//					filename: 'test.txt', // optional
//					contentType: 'text/plain' // optional
//				}]
			};
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
			format: "uri-reference",
			$helper: {
				name: 'page',
				title: 'Query',
				description: 'Values can be [$query.xxx]',
				query: true
			}
		},
		to: {
			title: 'Recipients emails',
			type: 'array',
			items: {
				type: 'string',
				format: 'email',
				transform: ['trim', 'toLowerCase']
			}
		}
	}
};
exports.send.external = true;
