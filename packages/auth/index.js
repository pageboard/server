var upcacheScope = require('upcache/scope');

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
		var scope = getScope(opt.scope);
		All.auth.restrict = scope.restrict.bind(scope);
		All.auth.test = scope.test.bind(scope);
		All.auth.cookie = scope.serializeBearer.bind(scope);

		All.app.use('/.api/auth/*', All.cache.disable());

		All.app.get('/.api/auth/login', All.auth.restrict("auth.login"), function(req, res, next) {
			return All.run('auth.login', req.site, req.query).then(function(linkObj) {
				res.send(linkObj);
			}).catch(next);
		});

		All.app.get('/.api/auth/validate', function(req, res, next) {
			return All.run('auth.validate', req.site, req.query).then(function(settings) {
				var keys = {};
				var session = settings.data.session;
				session.grants.forEach(function(grant) {
					keys[grant] = true;
				});
				scope.login(res, {
					id: settings.id,
					scopes: keys
				});
				res.redirect(session.referer || '/');
			}).catch(next);
		});

		All.app.get('/.api/auth/logout', function(req, res, next) {
			scope.logout(res);
			res.redirect('back');
		});

		All.app.use(All.auth.restrict('*'));
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
		schema.title = 'Send auth login';
		schema.$action = 'write';
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
	$action: 'write',
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

function getScope(scopeOpts) {
	var scope = upcacheScope(scopeOpts);
	scope.login = function(res, user, opts) {
		if (res) {
			opts = Object.assign({}, this.config, opts);
		}
		var bearer = this.sign(res.req, user, opts);
		var host = All.domains.hosts[res.req.hostname];
		if (res) res.cookie('bearer', bearer, {
			maxAge: opts.maxAge * 1000,
			httpOnly: true,
			sameSite: true,
			secure: host && host.protocol == "https" || false,
			path: '/'
		});
		return bearer;
	};
	scope.logout = function(res) {
		var host = All.domains.hosts[res.req.hostname];
		res.clearCookie('bearer', {
			httpOnly: true,
			sameSite: true,
			secure: host && host.protocol == "https" || false,
			path: '/'
		});
	};
	return scope;
}

