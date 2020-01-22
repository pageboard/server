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
	Object.entries(opt.mail).forEach(([type, conf]) => {
		if (!Transports[conf.transport]) {
			console.warn("mail transport not supported", type, conf.transport);
			return;
		}
		if (!conf.domain) {
			console.warn("mail domain must be set", type);
			return;
		}
		if (!conf.sender) {
			console.warn("mail sender must be set", type);
			return;
		}
		if (!conf.auth) {
			console.warn("mail auth be set", type);
			return;
		}
	});

	return {
		name: 'mail',
		service: init
	};
};

function init(All) {
	Object.entries(All.opt.mail).forEach(([type, conf]) => {
		Log.mail(type, conf);
		Mailers[type] = {
			transport: NodeMailer.createTransport(Transports[conf.transport]({auth: conf.auth})),
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
				return exports.to(req, {
					from: {
						name: site.data.title,
						address: `${site.id}.${senders[0].id}@${mailer.domain}`
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
exports.receive.schema = {
	$action: 'write',
	additionalProperties: true
};

exports.to = function(req, data) {
	var type = data.type;
	data = Object.assign({}, data);
	delete data.type;
	var mailer = Mailers[type];
	if (!mailer) throw new Error("Unknown mailer type " + type);
	if (type == "transactional" && data.to.length > 1) {
		throw new Error("Transactional mail only accepts one recipient");
	}

	data.from = buildAddress(AddressParser(data.from)[0], mailer.sender);
	Log.mail("from", data.from);
	return mailer.transport.sendMail(data);
};
exports.to.schema = {
	$action: 'write',
	required: ['subject', 'to', 'text'],
	properties: {
		type: {
			title: 'Type',
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
	var type = data.type;
	data = Object.assign({}, data);
	delete data.type;
	const mailer = Mailers[type];
	if (!mailer) throw new Error("Unknown mailer type " + type);

	var list = [All.run('block.find', req, {
		type: 'mail',
		data: {url: data.url}
	})];
	var mailOpts = {};
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
			address: `${site.id}.${rows[1]}@${mailer.domain}`
		};
		mailOpts.to = rows.slice(-1).pop();
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
			return exports.to(req, mailOpts);
		});
	});
};
exports.send.schema = {
	title: 'Send email',
	$action: 'write',
	required: ['url', 'to'],
	properties: {
		type: {
			title: 'Type',
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

function buildAddress(obj={}, def) {
	obj = Object.assign({}, obj);
	if (!obj.name) {
		delete obj.name;
		if (!obj.address) obj = def;
	}	else if (!obj.address) {
		obj.address = def.address;
	}
	if (!obj.name) return obj.address;
	else return `"${obj.name}" <${obj.address}>`;
}
