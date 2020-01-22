const Path = require('path');
const NodeMailer = require('nodemailer');
const AddressParser = require('addressparser');
const Transports = {
	mailgun: require('nodemailer-mailgun-transport'),
	postmark: require('nodemailer-postmark-transport')
};
const Mailers = {};

const got = require('got');

const multipart = require('./lib/multipart.js');
const validateMailgun = require('./lib/validate-mailgun.js');

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
		priority: 1, // after read plugin
		name: 'mail',
		service: init,
		view: function(All) {
			var path = Path.join(__dirname, './lib/mail');
			All.opt.prerender.helpers.unshift(path);
			All.opt.prerender.plugins.push(path);
			All.opt.read.helpers.push('mail');
		}
	};
};

function init(All) {
	Object.entries(All.opt.mail).forEach(([purpose, conf]) => {
		Mailers[purpose] = {
			transport: NodeMailer.createTransport(Transports[conf.transport]({auth: conf.auth})),
			auth: conf.auth,
			domain: conf.domain,
			sender: AddressParser(conf.sender)[0]
		};
	});

	All.app.post('/.api/mail', multipart, function(req, res, next) {
		All.run('mail.receive', req.body).then(function(ok) {
			// https://documentation.mailgun.com/en/latest/user_manual.html#receiving-messages-via-http-through-a-forward-action
			if (!ok) res.sendStatus(406);
			else res.sendStatus(200);
		}).catch(next);
	});
	All.opt.extnames.push('mail');
}

function send(mailer, mail) {
	return new Promise(function(resolve, reject) {
		mailer.sendMail(mail, function (err, info) {
			if (err) reject(err);
			else resolve(info);
		});
	});
}

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
	return All.run('user.get', {
		email: senders
	}).then(function(sender) {
		return Promise.all(AddressParser(data.recipient).map(function(item) {
			var parts = item.address.split('@');
			if (parts.pop() != mailer.domain) return false;
			parts = parts[0].split('.');
			if (parts.length != 2) return false;
			var siteId = parts[0];
			var userId = parts[1];
			return Promise.all([
				All.run('user.get', {id: userId}),
				All.run('site.get', {id: siteId})
			]).then(function([user, site]) {
				return send(mailer, {
					from: {
						name: site.data.domains[0],
						address: `${site.id}.${sender.id}@${mailer.domain}`
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
	var purpose = "transactional";
	var mailer = Mailers[purpose];
	if (!mailer) throw new Error("Unknown mailer purpose " + purpose);

	var list = [All.run('block.search', site, {
		type: 'mail',
		data: {url: data.url}
	})];
	if (data.from) list.push(All.run('user.get', {
		email: data.from
	}));

	return Promise.all(list).then(function(rows) {
		var pages = rows[0];
		var from = mailer.sender;
		if (rows.length > 1) from = {
			name: site.data.domains[0],
			address: `${site.id}.${rows[1].id}@${mailer.domain}`
		};

		var emailPage = pages.data[0];
		if (!emailPage) throw new HttpError.NotFound("Page not found");
		var emailUrl = site.href + emailPage.data.url;

		return got(emailUrl + ".mail", {
			query: data.query,
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
			return send(mailer, mail);
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
