var upcacheScope = require('upcache/scope');

exports = module.exports = function(opt) {
	opt.plugins.unshift(
		__dirname + '/services/login'
	);
	return {
		priority: -10,
		name: 'auth',
		service: init
	};
};

// login: given an email, sets user.data.session.hash and returns an activation link
// validate: process activation link and return bearer in cookie

function init(All) {
	var opt = All.opt;
	opt.scope = Object.assign({
		maxAge: 60 * 60 * 24 * 31,
		userProperty: 'user',
		keysize: 2048
	}, opt.scope);

	return require('./lib/keygen')(All).then(function() {
		var scope = upcacheScope(opt.scope);

		All.auth.restrict = scope.restrict.bind(scope);
		All.auth.test = scope.test.bind(scope);
		All.auth.sign = scope.sign.bind(scope);

		All.app.use(All.auth.restrict('*'));
	});
}

