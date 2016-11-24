var upcacheScope = require('upcache/scope');

exports = module.exports = function(opt) {
	opt.scope = Object.assign({
		issuer: name,
		maxAge: 3600 * 12,
		userProperty: 'user'
	}, opt.scope);

	exports.scope = upcacheScope(opt.scope);

	return {
		service: init
	};
};

function init(All) {
	All.app.post('/api/login', function(req, res, next) {
		exports.login(req.body).then(function(session) {

		}).catch(next);
	});
	All.app.get('/api/logout', function(req, res, next) {
		exports.logout(res);
	});
}

exports.login = function(data) {
	return All.user.authenticate(data).then(function(user) {
		var bearer = exports.scope.login(res, {
			email: user.data.email,
			scopes: user.data.grants
		});
		return {
			scopes: user.data.grants,
			bearer: bearer
		};
	});
};

exports.logout = function(res) {
	exports.scope.logout(res);
};

