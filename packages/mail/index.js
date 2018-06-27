var NodeMailer = require('nodemailer');
var Mailgun = require('nodemailer-mailgun-transport');
var got = require('got');
// TODO https://nodemailer.com/dkim/

var mailPlugin = require('./express-dom-email');

var mailer, sender;

exports = module.exports = function(opt) {
	/*
	opt.mailer.transport
	opt.mailer.auth.api_key
	opt.mailer.auth.domain
	opt.mailer.sender - either a "name" <email> string or a sender.name sender.address object
	*/
	// TODO support available transports (SMTP, sendmail, SES)
	if (!opt.mail) return; // quietly return
	if (opt.mail.transport != 'mailgun') {
		console.warn("Only `mail.transport: mailgun` is supported");
		return;
	}
	if (!opt.mail.sender) {
		console.warn('Missing mail.sender');
		return;
	}
	mailer = NodeMailer.createTransport(Mailgun(opt.mail));
	sender = opt.mail.sender;

	return {
		priority: -10, // because default prerendering happens at 0
		name: 'mail',
		service: function(All) {
			All.dom.settings.helpers.unshift(mailPlugin);
		}
	};
};

exports.send = function(site, data) {
	return Promise.all([
		All.run('block.search', site, {
			type: 'mail',
			data: {url: data.url}
		}),
		All.run('user.get', {
			email: data.to
		})
	]).then(function([pages, user]) {
		var emailPage = pages.data[0];
		if (!emailPage) throw new HttpError.NotFound("Page not found");
		var emailUrl = site.href + emailPage.data.url;

		return got(emailUrl, {
			query: Object.assign(data.query, {
				email: true
			})
		}).then(function(response) {
			return JSON.parse(response.body);
		}).then(function(obj) {
			var mail = {
				from: sender,
				to: {
					name: user.data.name,
					address: user.data.email
				},
				subject: obj.title,
				/* this cannot really work. What could work is replying to <id>.pageboard.fr
				replyTo: {
					name: sender.data.name,
					address: sender.data.email
				},
				*/
				html: obj.html,
				text: obj.text,
//				attachments: [{
//					path: '/path/to/test.txt',
//					filename: 'test.txt', // optional
//					contentType: 'text/plain' // optional
//				}]
			};
			return new Promise(function(resolve, reject) {
				mailer.sendMail(mail, function (err, info) {
					if (err) reject(err);
					else resolve(info);
				});
			});
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
			type: 'string',
			format: 'email'
		}
	}
};
exports.send.external = true;
