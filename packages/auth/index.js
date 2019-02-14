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
		All.auth.sign = scope.sign.bind(scope);

		All.app.use(All.auth.restrict('*'));
	});
}

exports.install = function(site) {
	site.$grants = grantsLevels(site.constructor);
};

exports.locked = locked;
exports.filter = filter;

exports.filterResponse = function(site, scopes, obj) {
	if (!obj.item && !obj.items) {
		return filter(site, scopes, obj);
	}
	if (obj.item) {
		var item = filter(site, scopes, obj.item, 'read');
		if (!item) throw new HttpError.Unauthorized("user not granted");
	}
	if (obj.items) obj.items = obj.items.filter(function(item) {
		return filter(site, scopes, item, 'read');
	});
};

function grantsLevels(DomainBlock) {
	var grants = {};
	var list = DomainBlock.schema('settings.data.grants').items.anyOf || [];
	list.forEach(function(grant, i) {
		var n = grant.$level;
		if (typeof n != 'number' || isNaN(n)) {
			console.warn("grant without $level, ignoring", grant);
			return;
		}
		grants[grant.const] = n;
	});
	return grants;
}

function locked(site, user, locks) {
	if (locks == null) return false;
	if (typeof locks == "string") locks = [locks];
	if (locks.length == 0) return false;
	if (!user) return true;
	var grants = Object.keys(user.scopes || {});
	var scopes = {};
	var minLevel = Infinity;
	grants.forEach(function(grant) {
		scopes[grant] = true;
		minLevel = Math.min(site.$grants[grant], minLevel);
	});

	return !locks.some(function(lock) {
		var lockIndex = site.$grants[lock] || -1;
		return (lockIndex > minLevel) || scopes[lock];
	});
}

function filter(site, user, item, action) {
	if (!item.type) return item;
	if (item.children) {
		item.children = item.children.filter(function(item) {
			return filter(site, user, item, action);
		});
	}
	if (item.parents) {
		item.parents = item.parents.filter(function(item) {
			return filter(site, user, item, action);
		});
	}
	if (item.parent) {
		item.parent = filter(site, user, item.parent, action);
		if (!item.parent) return;
	}
	var schema = site.$schema(item.type) || {}; // old types might not have schema
	var $lock = schema.$lock || {};
	var lock = (item.lock || {})[action] || [];

	if (Object.keys($lock).length == 0 && lock.length == 0) return item;
	var locks = {
		'*': lock
	};
	if (typeof $lock != "object") $lock = { '*': $lock };
	locks = Object.assign({}, locks, $lock);
	if (locked(site, user, locks['*'])) return;
	delete locks['*'];
	Object.keys(locks).forEach(function(path) {
		var list = locks[path];
		path = path.split('.');
		path.reduce(function(obj, val, index) {
			if (obj == null) return;
			if (index == path.length - 1) {
				if (locked(site, user, list)) delete obj[val];
			}
			return obj[val];
		}, item);
	});
	return item;
}
