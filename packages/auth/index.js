const UpcacheLock = require('upcache').lock;

exports = module.exports = function(opt) {
	return {
		priority: -10,
		name: 'auth',
		service: init
	};
};

// login: given an email, sets user.data.session.hash and returns an activation link
// validate: process activation link and return bearer in cookie

function init(All) {
	opt.scope = Object.assign({
		maxAge: 60 * 60 * 24 * 31,
		userProperty: 'user',
		keysize: 2048
	}, opt.scope);

	return require('./lib/keygen')(All).then(function() {
		var lock = UpcacheLock(opt.scope);
		All.auth.restrict = lock.restrict;
		All.auth.vary = lock.vary;
		All.auth.headers = lock.headers;

		All.app.use('/.api/auth/*', All.cache.disable());

		All.app.get('/.api/auth/login', All.auth.restrict("auth.login"), function(req, res, next) {
			return All.run('auth.login', req.site, req.query).then(function(linkObj) {
				res.send(linkObj);
			}).catch(next);
		});

		All.app.get('/.api/auth/validate', function(req, res, next) {
			return All.run('auth.validate', req.site, req.query).then(function(settings) {
				var session = settings.data.session;
				lock.login(res, {
					id: settings.id,
					grants: session.grants
				});
				res.redirect(session.referer || '/');
			}).catch(next);
		});

		All.app.get('/.api/auth/logout', function(req, res, next) {
			lock.logout(res);
			res.redirect('back');
		});

		All.app.use(All.auth.vary('*'));
	});
}

// formulaire de login -> auth.login -> mail option which receives the validation url by query

exports.login = function(site, data) {
	return All.settings.find(site, data).select('settings._id')
	.forUpdate().then(function(settings) {
		if (!isGranted(data.grants, settings)) {
			throw new HttpError.Forbidden("Insufficient grants");
		}
		return All.api.Block.genId(16).then(function(hash) {
			// problem here
			// the hash is returned at the same time the grants are asked
			// the form should ask grants
			return settings.$query(site.trx).patch({
				'data:session': {
					grants: data.grants,
					hash: hash,
					verified: false,
					referer: data.referer || null
				}
			}).then(function(count) {
				if (count == 0) throw new HttpError.ServerError("Could not patch settings");
				var validation = `/.api/auth/validate?id=${settings.id}&hash=${hash}`;
				if (data.url) {
					return All.run('mail.send', site, {
						url: data.url,
						query: {
							validation: validation
						},
						to: data.email
					});
				} else {
					return validation;
				}
			});
		});
	});
};

Object.defineProperty(exports.login, 'schema', {
	get: function() {
		var schema = Object.assign({}, All.settings.find.schema);
		schema.required = (schema.required || []).concat(['grants']);
		schema.properties = Object.assign({
			grants: {
				type: 'array',
				uniqueItems: true,
				items: {
					type: 'string'
				}
			},
			url: {
				anyOf: [{
					type: 'null'
				}, {
					type: 'string',
					pattern: "^(/[a-zA-Z0-9-.]*)+$" // notice the absence of underscore
				}],
				input: {
					name: 'href',
					filter: {
						type: ["link"]
					}
				}
			}
		}, schema.properties);
		return schema;
	}
});
exports.login.external = true;

exports.validate = function(site, data) {
	return All.settings.get(site, data).select('_id').forUpdate()
	.then(function(settings) {
		var hash = settings.data.session && settings.data.session.hash;
		if (!hash) {
			throw new HttpError.BadRequest("Unlogged user");
		}
		if (settings.data.session.verified) {
			throw new HttpError.BadRequest("Already logged user");
		}
		if (hash != data.hash) {
			throw new HttpError.BadRequest("Bad validation link");
		}
		return settings.$query(site.trx).patch({
			'data:session.verified': true
		}).then(function(count) {
			if (count == 0) throw new HttpError.NotFound("Bad validation link");
			return settings;
		});
	});
};
exports.validate.schema = {
	required: ['id', 'hash'],
	properties: {
		id: {
			type: 'string',
			minLength: 1
		},
		hash: {
			type: 'string',
			minLength: 1
		}
	}
};

function isGranted(grants, settings) {
	if (!grants.length) return false;
	if (!settings.data || !settings.data.grants || !settings.data.grants.length) return false;
	return grants.every(function(grant) {
		return settings.data.grants.indexOf(grant) >= 0;
	});
}

