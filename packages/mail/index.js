var NodeMailer = require('nodemailer');
var AddressParser = require('nodemailer/lib/addressparser');
var Mailgun = require('nodemailer-mailgun-transport');
var got = require('got');
// TODO https://nodemailer.com/dkim/
// TODO https://postmarkapp.com/blog/differences-in-delivery-between-transactional-and-bulk-email
// use a different domain for transactional and for bulk sending

var mailPlugin = require('./lib/express-dom-email');
var validateMailgun = require('./lib/validate-mailgun.js');

var mailer, defaultSender, mailDomain;

exports = module.exports = function(opt) {
	/*
	opt.mail.transport
	opt.mail.api_key
	opt.mail.domain
	opt.mail.sender (the name of the email address)
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
			All.app.post('/.api/mail', function(req, res, next) {
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

function send(mail) {
	return new Promise(function(resolve, reject) {
		mailer.sendMail(mail, function (err, info) {
			if (err) reject(err);
			else resolve(info);
		});
	});
}

exports.receive = function(data) {
	// https://documentation.mailgun.com/en/latest/user_manual.html#parsed-messages-parameters
	if (!validateMailgun(All.opt.mail.mailgun, data.timestamp, data.token, data.signature)) {
		return false;
	}
	return All.run('user.get', {
		email: AddressParser(data.sender).address
	}).then(function(sender) {
		return Promise.all(AddressParser(data.recipient).map(function(item) {
			var parts = item.address.split('@');
			if (parts.pop() != mailDomain) return false;
			parts = parts[0].split('.');
			if (parts.length != 2) return false;
			var siteId = parts[0];
			var userId = parts[1];
			console.info("Received mail", siteId, userId, data.sender, data.from, data.subject);
			return Promise.all([
				All.run('user.get', {id: userId}),
				All.run('site.get', {id: siteId})
			]).then(function([user, site]) {
				return send({
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

exports.send = function(site, data) {
	var list = [All.run('block.search', site, {
		type: 'mail',
		data: {url: data.url}
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

		var emailPage = pages.data[0];
		if (!emailPage) throw new HttpError.NotFound("Page not found");
		var emailUrl = site.href + emailPage.data.url;

		return got(emailUrl, {
			query: Object.assign(data.query || {}, {
				email: true
			})
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
			return send(mail);
		});
	});
};
exports.send.schema = {
	required: ['url', 'to'],
	properties: {
		url: {
			type: 'string'
		},
		query: {
			type: 'object'
		},
		to: {
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
