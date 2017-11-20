var NodeMailer = require('nodemailer');
var Mailgun = require('nodemailer-mailgun-transport');
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
		service: function(All) {
			All.app.get('/.api/email', All.query, function(req, res, next) {
				exports.get(req.query).then(function(result) {
					res.send(result);
				}).catch(next);
			});
		},
		view: function(All) {
			return domemail.init().then(function() {
				// TODO remove cache.tag call if express-dom keeps headers when proxying
				All.app.get('*', All.cache.tag('api', 'share', 'file'), All.dom(domemail.mw));
			});
		}
	};
};

function filterUser(id, builder) {
	builder.select(this.tableColumns).where({
		id: id,
		type: 'user'
	}).first().throwIfNotFound();
}

exports.get = function(data) {
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	if (!data.url) throw new HttpError.BadRequest("Missing url");
	if (!data.to) throw new HttpError.BadRequest("Missing to");
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

		return Block.query().select(Block.tableColumns).whereDomain(Block.domain)
		.eager(`[${what.join(',')}]`, filters).first().throwIfNotFound()
	}).then(function(site) {
		if (!site.from) site.from = site.owner;
		return got(site.page.data.url, {
			query: {
				email: true
			}
		}).then(function(obj) {
			var mail = {
				from: sender,
				to: {
					name: site.to.data.name,
					address: site.to.data.email
				},
				subject: obj.title,
				replyTo: {
					name: site.from.data.name,
					address: site.from.data.email
				},
				html: obj.html,
				text: obj.text,
//				attachments: [{
//					path: '/path/to/test.txt',
//					filename: 'test.txt', // optional
//					contentType: 'text/plain' // optional
//				}]
			};
			var copy = Object.assign({}, mail);
			copy.html = html.length + ' chars';
			copy.text = text.length + ' chars';
			console.info("Sending", copy);
			return new Promise(function(resolve, reject) {
				mailer.sendMail(mail, function (err, info) {
					if (err) reject(err);
					else resolve(info);
				});
			});
		});
	});

	// TODO handle attachments - data.files are files url
	// it's up to another API to handle the uploads and return the files url

	// 1. get from, to, url and check they match a block in this domain
	// 2. get html from url - give some "internal" permission
	// 3. send email !




};
