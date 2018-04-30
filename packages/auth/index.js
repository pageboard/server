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
		var scope = upcacheScope(opt.scope);
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

exports.login = function(site, data) {
	return All.api.trx(function(trx) {
		return All.settings.find(site, data).select('settings._id')
		transacting(trx).forUpdate().then(function(settings) {
			if (!isGranted(data.grants, settings)) {
				throw new HttpError.Forbidden("Insufficient grants");
			}
			return All.api.Block.genId(16).then(function(hash) {
				return settings.$query(trx).patch({
					'data:session': {
						grants: data.grants,
						hash: hash,
						verified: false,
						referer: data.referer || null
					}
				}).then(function(count) {
					if (count == 0) throw new HttpError.ServerError("Could not patch settings");
					return {
						type: 'login',
						data: {
							href: `/.api/auth/validate?id=${settings.id}&hash=${hash}`
						}
					};
				});
			});
		});
	});
};

Object.defineProperty(exports.login, 'schema', {
	get: function() {
		var schema = Object.assign({}, All.user.get.schema);
		schema.required = (schema.required || []).concat(['grants']);
		schema.properties = Object.assign({}, schema.properties);
		schema.properties.grants = All.api.Block.schema('settings').properties.grants;
		return schema;
	}
});

exports.validate = function(site, data) {
	return All.settings.get(site, data).select('_id').then(function(settings) {
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
		return settings.$query().patchObject({
			data: { session: { verified: true }}
		}).then(function(count) {
			if (count == 0) throw new HttpError.NotFound("Bad validation link");
			return settings;
		});
	});
};
Object.defineProperty(exports.validate, 'schema', {
	get: function() {
		var schema = Object.assign({}, All.settings.get.schema);
		schema.required = (schema.required || []).concat(['hash']);
		schema.properties = Object.assign({}, schema.properties);
		schema.properties.hash = All.api.Block.schema('settings').properties.session.properties.hash;
		return schema;
	}
});

function isGranted(grants, settings) {
	if (!grants.length) return false;
	if (!settings.data || !settings.data.grants || !settings.data.grants.length) return false;
	return grants.every(function(grant) {
		return settings.data.grants.indexOf(grant) >= 0;
	});
}

