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
	opt.lock = Object.assign({
		maxAge: 60 * 60 * 24 * 31,
		userProperty: 'user',
		keysize: 2048
	}, opt.lock);

	return require('./lib/keygen')(All).then(function() {
		var lock = UpcacheLock(opt.lock);

		All.auth.vary = lock.vary;
		All.auth.headers = lock.headers;
		All.auth.cookie = function({site, user}) {
			return {
				value: lock.sign(user, Object.assign({
					hostname: site.hostname
				}, opt.lock)),
				maxAge: opt.lock.maxAge * 1000
			};
		};

		All.app.use(lock.init);
	});
}

exports.install = function(site) {
	site.$grants = grantsLevels(site.constructor);
};

exports.lock = lockMw;
exports.locked = locked;
exports.filter = filter;

exports.filterResponse = function(req, obj) {
	if (!obj.item && !obj.items) {
		return filter(req, obj);
	}
	if (obj.item) {
		var item = filter(req, obj.item, 'read');
		if (!item.type) throw new HttpError.Unauthorized("user not granted");
	}
	if (obj.items) obj.items = obj.items.map(function(item) {
		return filter(req, item, 'read');
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

function lockMw(lock) {
	return function(req, res, next) {
		if (locked(req, lock)) {
			All.auth.headers(res, lock);
			if ((req.user.grants || []).length == 0) {
				next(new HttpError.Unauthorized());
			} else {
				next(new HttpError.Forbidden());
			}
		} else {
			next();
		}
	};
}

function locked(req, locks) {
	var {site, user, doors} = req;
	if (!doors) doors = req.doors = [];
	if (locks == null) return false;
	if (typeof locks == "string") locks = [locks];
	if (locks.length == 0) return false;
	var minLevel = Infinity;
	var grants = user.grants || [];
	grants.forEach(function(grant) {
		minLevel = Math.min(site.$grants[grant] || Infinity, minLevel);
	});

	var granted = false;
	locks.forEach(function(lock) {
		var lockIndex = site.$grants[lock] || -1;
		var door = lock;
		if (lock.startsWith('id-')) {
			if ('id-' + user.id == lock) granted = true;
			door = 'id-:id';
		} else if ((lockIndex > minLevel) || grants.includes(lock)) {
			granted = true;
		}
		if (!doors.includes(door)) doors.push(door);
	});
	return !granted;
}

function filter(req, item, action) {
	if (!item.type) return item;
	if (item.children) {
		item.children = item.children.filter(function(item) {
			return filter(req, item, action);
		});
	}
	if (item.child) {
		item.child = filter(req, item.child, action);
	}
	if (item.parents) {
		item.parents = item.parents.filter(function(item) {
			return filter(req, item, action);
		});
	}
	if (item.parent) {
		item.parent = filter(req, item.parent, action);
	}
	var schema = req.site.$schema(item.type) || {}; // old types might not have schema
	var $lock = schema.$lock || {};
	var lock = (item.lock || {})[action] || [];

	if (Object.keys($lock).length == 0 && lock.length == 0) return item;
	var locks = {
		'*': lock
	};
	if (typeof $lock != "object") $lock = { '*': $lock };
	locks = Object.assign({}, locks, $lock);
	if (locked(req, locks['*'])) return {
		id: item.id
	};
	delete locks['*'];
	Object.keys(locks).forEach(function(path) {
		var list = locks[path];
		path = path.split('.');
		path.reduce(function(obj, val, index) {
			if (obj == null) return;
			if (index == path.length - 1) {
				if (locked(req, list)) delete obj[val];
			}
			return obj[val];
		}, item);
	});
	return item;
}

