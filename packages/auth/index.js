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
			exports.login(req.query).then(function(linkObj) {
				res.send(linkObj);
			}).catch(next);
		});

		All.app.get('/.api/auth/validate', function(req, res, next) {
			exports.validate(req.query).then(function(user) {
				// check if user owns this site
				var owner = user.sites.some(function(site) {
					return site.id == req.site.id;
				});
				// upcache sets jwt.issuer to req.hostname so we should be fine
				var keys = user.keys || {};
				if (owner) keys.webmaster = true;
				scope.login(res, {
					id: user.id,
					scopes: keys
				});
				res.redirect(user.data.session.referer || '/');
			}).catch(next);
		});

		All.app.get('/.api/auth/logout', function(req, res, next) {
			scope.logout(res);
			res.redirect('back');
		});

		All.app.use(All.auth.restrict('*'));
	});
}

exports.login = function(data) {
	return All.user.get(data).select('_id').then(function(user) {
		return All.api.Block.genId(16).then(function(hash) {
			return user.$query().skipUndefined().patch({
				'data:session': {
					hash: hash,
					done: false,
					referer: data.referer
				}
			}).then(function(count) {
				if (count == 0) throw new HttpError.NotFound("TODO use a transaction here");
				return {
					type: 'login',
					data: {
						href: `/.api/auth/validate?id=${user.id}&hash=${hash}`
					}
				};
			});
		});
	});
};

Object.defineProperty(exports.login, 'schema', {
	enumerable: true,
	configurable: false,
	get: function() {
		return All.user.get.schema;
	}
});

exports.validate = function(data) {
	return All.user.get(data).select('_id').eager('children(sites) as sites', {
		sites: function(builder) {builder.where('type', 'site');}
	}).then(function(user) {
		var hash = user.data.session && user.data.session.hash;
		if (!hash) {
			throw new HttpError.BadRequest("Unlogged user");
		}
		if (user.data.session.done) {
			throw new HttpError.BadRequest("Already logged user");
		}
		if (hash != data.hash) {
			throw new HttpError.BadRequest("Bad validation link");
		}
		return user.$query().where('id', user.id).skipUndefined().patch({
			'data:session.done': true
		}).then(function(count) {
			if (count == 0) throw new HttpError.NotFound("User has been deleted since activation");
			return user;
		});
	});
};

