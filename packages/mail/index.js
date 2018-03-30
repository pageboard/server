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

exports.send = function(site, data) {
	var Block = site.Block;
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

	return site.$query()
	.eager(`[${what.join(',')}]`, filters)
	.then(function(row) {
		if (!row.from) row.from = row.owner;
		var emailUrl = site.href + row.page[0].data.url;
		var authCookie = All.auth.cookie({hostname: site.hostname}, {
			scopes: {
				"auth.login": true
			}
		});

		return got(emailUrl, {
			json: true,
			query: {
				from: row.from[0].id,
				to: row.to[0].id,
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
					name: row.to[0].data.name,
					address: row.to[0].data.email
				},
				subject: obj.title,
				replyTo: {
					name: row.from[0].data.name,
					address: row.from[0].data.email
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
	required: ['url', 'to'],
	properties: {
		url: {
			type: 'string'
		},
		to: {
			type: 'string',
			format: 'email'
		}
	}
};
