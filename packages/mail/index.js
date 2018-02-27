var NodeMailer = require('nodemailer');
var Mailgun = require('nodemailer-mailgun-transport');
var got = require('got');
// TODO https://nodemailer.com/dkim/

var domemail = require('./express-dom-email');

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
		/* disable /.api/mail because mail.send is called by /.api/form
		service: function(All) {
			All.app.post('/.api/email', All.body, function(req, res, next) {
				exports.send(req.body).then(function(result) {
					res.send(result);
				}).catch(next);
			});
		},*/
		view: function(All) {
			return domemail.init().then(function() {
				// TODO remove cache.tag call if express-dom keeps headers when proxying
				All.app.get('*',
					function(req, res, next) {
						if (req.query.email !== undefined) {
							delete req.query.email;
							next();
						} else {
							next('route');
						}
					},
					All.cache.tag('api', 'share', 'file'),
					domemail.mw(All.dom)
				);
			});
		}
	};
};

function filterUser(email, builder) {
	builder.select(this.tableColumns)
		.whereJsonText('block.data:email', email)
		.where('block.type', 'user')
		.first().throwIfNotFound();
}

exports.send = function(data) {
	return All.api.DomainBlock(data.domain).then(function(Block) {
		var what = [
			'parents(owner) as owner',
			'children(to) as to',
			'children(page) as page'
		];
		var filters = {
			to: filterUser.bind(Block, data.to),
			page: function(builder) {
				builder.select(Block.tableColumns)
					.where('type', 'page')
					.whereJsonText('block.data:url', data.url)
					.first().throwIfNotFound();
			},
			owner: function(builder) {
				builder.select(Block.tableColumns)
					.where('type', 'user')
					.first().throwIfNotFound();
			}
		};
		if (data.from) {
			what.push('children(from) as from');
			filters.from = filterUser.bind(Block, data.from);
		}

		return Block.query().select(Block.tableColumns)
		.whereJsonText('block.data:domain', data.domain)
		.eager(`[${what.join(',')}]`, filters)
		.where('block.type', 'site').first().throwIfNotFound();
	}).then(function(site) {
		if (!site.from) site.from = site.owner;
		var emailUrl = All.domains.host(site.data.domain) + site.page[0].data.url;
		var authCookie = All.auth.cookie({hostname: site.data.domain}, {
			scopes: {
				"auth.login": true
			}
		});

		return got(emailUrl, {
			json: true,
			query: {
				from: site.from[0].id,
				to: site.to[0].id,
				email: true
			},
			headers: {
				cookie: authCookie
			}
		}).then(function(response) {
			return response.body;
		}).then(function(obj) {
			var mail = {
				from: sender,
				to: {
					name: site.to[0].data.name,
					address: site.to[0].data.email
				},
				subject: obj.title,
				replyTo: {
					name: site.from[0].data.name,
					address: site.from[0].data.email
				},
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
	required: ['domain', 'url', 'to'],
	properties: {
		domain: {
			type: 'string'
		},
		url: {
			type: 'string'
		},
		to: {
			type: 'string',
			format: 'email'
		}
	}
};
