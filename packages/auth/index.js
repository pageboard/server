const UpcacheLock = require('upcache').lock;

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

	return require('./lib/keygen')(All).then(function(keys) {
		Object.assign(opt.scope, keys);
		var lock = UpcacheLock(opt.scope);
		All.auth.restrict = lock.restrict.bind(lock);
		All.auth.vary = lock.vary;
		All.auth.headers = lock.headers;
		All.auth.cookie = function(site, user) {
			return {
				value: lock.sign(user, Object.assign({
					hostname: site.hostname
				}, opt.scope)),
				maxAge: opt.scope.maxAge * 1000
			};
		};

		All.app.use(All.auth.vary('*'));
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

function locked(site, user, list) {
	if (list != null && !Array.isArray(list) && typeof list == "object" && list.read !== undefined) {
		// backward compat, block.lock only cares about read access
		list = list.read;
	}
	if (list == null) return false;
	if (typeof list == "string") list = [list];
	if (list === true || list.length == 0) return false;
	var minLevel = Infinity;
	var grants = user.grants || [];
	grants.forEach(function(grant) {
		minLevel = Math.min(site.$grants[grant] || Infinity, minLevel);
	});

	var granted = false;
	list.forEach(function(lock) {
		var lockIndex = site.$grants[lock] || -1;
		if (/^(user|id)-/.test(lock)) {
			if (user.id == lock.split('-').pop()) granted = true;
		} else if ((lockIndex > minLevel) || grants.includes(lock)) {
			granted = true;
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
