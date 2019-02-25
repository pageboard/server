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
		All.auth.headers = scope.headers.bind(scope);
		All.auth.sign = scope.sign.bind(scope);

		All.app.use(function(req, res, next) {
			scope.handshake(req, res, function() {});
			scope.parseBearer(req);
			if (!req.user) req.user = {};
			next();
		});
	});
}

exports.install = function(site) {
	site.$grants = grantsLevels(site.constructor);
};

exports.locked = locked;
exports.filter = filter;

exports.filterResponse = function(site, user, obj) {
	if (!user) user = {};
	if (!obj.item && !obj.items) {
		return filter(site, user, obj);
	}
	if (obj.item) {
		var item = filter(site, user, obj.item, 'read');
		if (!item.type) throw new HttpError.Unauthorized("user not granted");
	}
	if (obj.items) obj.items = obj.items.map(function(item) {
		return filter(site, user, item, 'read');
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
	if (!user) user = {};
	if (!user.grants) user.grants = {};
	var grants = Object.keys(user.scopes || {});
	var scopes = {};
	var minLevel = Infinity;
	grants.forEach(function(grant) {
		if (grant == "user") {
			scopes[`user-${user.id}`] = true;
		}
		scopes[grant] = true;
		minLevel = Math.min(site.$grants[grant], minLevel);
	});

	var granted = locks.some(function(lock) {
		// NB: user-:id grants cannot be accessed by any other
		var lockIndex = site.$grants[lock] || -1;
		if ((lockIndex > minLevel) || scopes[lock]) {
			user.grants[lock] = true;
			return true;
		}
	});
	return !granted;
}

function filter(site, user, item, action) {
	if (!item.type) return item;
	if (item.children) {
		item.children = item.children.filter(function(item) {
			return filter(site, user, item, action);
		});
	}
	if (item.child) {
		item.child = filter(site, user, item.child, action);
	}
	if (item.parents) {
		item.parents = item.parents.filter(function(item) {
			return filter(site, user, item, action);
		});
	}
	if (item.parent) {
		item.parent = filter(site, user, item.parent, action);
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
	if (locked(site, user, locks['*'])) return {
		id: item.id
	};
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
