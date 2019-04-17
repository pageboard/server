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

	return require('./lib/keygen')(All).then(function(keys) {
		Object.assign(opt.lock, keys);
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
	var {item, items} = obj;
	if (!item && !items) {
		return filter(req, obj);
	}
	if (item) {
		obj.item = filter(req, item);
		if (!obj.item.type) delete obj.items;
	}
	if (obj.items) obj.items = obj.items.map(function(item) {
		return filter(req, item);
	});
	return obj;
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

function lockMw(list) {
	return function(req, res, next) {
		if (typeof list == "string") list = [list];
		if (locked(req, list)) {
			All.auth.headers(res, list);
			var status = (req.user.grants || []).length == 0 ? 401 : 403;
			res.status(status);
			res.send({locks: req.locks});
		} else {
			next();
		}
	};
}

function locked(req, list) {
	var {site, user, locks} = req;
	if (!locks) locks = req.locks = [];
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
		if (lock.startsWith('id-')) {
			if (`id-${user.id}` == lock) granted = true;
			lock = 'id-:id';
		} else if ((lockIndex > minLevel) || grants.includes(lock)) {
			granted = true;
		}
		if (!locks.includes(lock)) locks.push(lock);
	});
	locks.sort(function(a, b) {
		var al = site.$grants[a] || -1;
		var bl = site.$grants[b] || -1;
		if (al == bl) return 0;
		else if (al < bl) return 1;
		else if (al > bl) return -1;
	});
	return !granted;
}

function filter(req, item) {
	if (!item.type) return item;
	var {children, child, parents, parent} = item;
	if (children) {
		item.children = children.filter(function(item) {
			return filter(req, item);
		});
	}
	if (parents) {
		item.parents = parents.filter(function(item) {
			return filter(req, item);
		});
	}
	if (child) {
		item.child = filter(req, child);
	}
	if (parent) {
		item.parent = filter(req, parent);
	}
	// old types might not have schema
	var schema = req.site.$schema(item.type) || {};

	var $lock = schema.$lock || {};
	if (typeof $lock == "string" || Array.isArray($lock)) $lock = {'*': $lock};
	var lock = (item.lock || {}).read || [];

	if (Object.keys($lock).length == 0 && lock.length == 0) return item;

	var locks = {
		'*': lock
	};
	locks = Object.assign({}, locks, $lock);
	if (locked(req, locks['*'])) {
		if (item.content != null) item.content = {};
		if (item.data != null) item.data = {};
		if (item.expr != null) item.expr = {};
		delete item.type;
		return item;
	}
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

