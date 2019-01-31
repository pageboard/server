var objection = require('objection');
var knex = require('knex');

var ajv = require('ajv');
var AjvKeywords = require('ajv-keywords');
var ajvMetaSchema = require('ajv/lib/refs/json-schema-draft-06.json');

var bodyParserJson = require('body-parser').json();

var dba = require('./lib/dba');
var imports = require('./lib/imports');
var utils = require('./lib/utils');
var common = require('./models/common');


var ajvApiSettings = {
	$data: true,
	allErrors: true,
	validateSchema: true,
	ownProperties: true,
	coerceTypes: 'array',
	removeAdditional: false,
	nullable: true,
	formats: {
		singleline: /^[^\n\r]*$/,
		pathname: /^(\/[\w-.]*)+$/,
		id: /^[\w-]+$/
	}
};
var ajvApiWithDefaults = AjvKeywords(ajv(Object.assign({}, ajvApiSettings, {
	useDefaults: true
})).addMetaSchema(ajvMetaSchema));

var ajvApiWithNoDefaults = AjvKeywords(ajv(Object.assign({}, ajvApiSettings, {
	useDefaults: false
})).addMetaSchema(ajvMetaSchema));

exports = module.exports = function(opt) {
	opt.plugins.unshift(
		__dirname + '/services/user',
		__dirname + '/services/site',
		__dirname + '/services/settings',
		__dirname + '/services/page',
		__dirname + '/services/block',
		__dirname + '/services/href',
		__dirname + '/services/form',
		__dirname + '/services/query',
		__dirname + '/services/event'
	);
	opt.models = [
		__dirname + '/models/block',
		__dirname + '/models/href'
	];
	opt.seeds = [__dirname + '/seeds'];
	opt.migrations = [__dirname + '/migrations'];
	return {
		name: 'api',
		priority: -1,
		service: init
	};
};

function init(All) {
	var opt = All.opt;
	var dbOpt = dba.knexConfig(opt);
	var knexInst = knex(dbOpt);

	common.Model.createValidator = function() {
		return new objection.AjvValidator({
			onCreateAjv: function(ajv) {
				ajv.addMetaSchema(ajvMetaSchema);
				AjvKeywords(ajv);
			},
			options: {
				$data: true,
				allErrors: true,
				validateSchema: false,
				ownProperties: true,
				coerceTypes: 'array',
				removeAdditional: "all",
				nullable: true,
				formats: ajvApiSettings.formats
			}
		});
	};
	common.Model.knex(knexInst);

	var models = {};
	opt.models.forEach(function(path) {
		var model = require(path);
		models[model.name] = model;
	});

	exports.Href = models.Href;
	exports.Block = models.Block;
	exports.transaction = function(fn) {
		if (fn) return knexInst.transaction(fn);
		else return objection.transaction.start(knexInst);
	};

	exports.migrate = dba.migrate.bind(null, knexInst, opt.migrations);
	exports.seed = dba.seed.bind(null, knexInst, opt.seeds);
	exports.dump = dba.dump.bind(null, dbOpt.connection, opt);
	exports.gc = dba.gc;

	Object.keys(utils).forEach(function(key) {
		if (All.utils[key]) throw new Error(`Cannot reassign All.utils.${key}`);
		All.utils[key] = utils[key];
	});

	Object.assign(exports, imports);

	// api depends on site files
	All.app.get('/.api/*', All.cache.tag('app-:site'));
	All.app.use('/.api/*',
		// varies on any permission
		All.auth.restrict('*'),
		// invalid site by site
		All.cache.tag('data-:site'),
		// parse json bodies
		bodyParserJson
	);
}


function check(fun, data) {
	if (!fun.schema || fun.schema.additionalProperties) return data;
	if (!fun.validate) {
		if (fun.schema.defaults === false) {
			fun.validate = ajvApiWithNoDefaults.compile(fun.schema);
		} else {
			fun.validate = ajvApiWithDefaults.compile(fun.schema);
		}
	}
	// coerceTypes mutates data
	if (fun.validate(data)) {
		return data;
	} else {
		var messages = fun.validate.errors.map(function(err) {
			if (err.dataPath) return `${err.dataPath} ${err.message}`;
			else return err.message;
		}).join(',\n');
		throw new HttpError.BadRequest(`Bad api parameters: \n${messages}`);
	}
}

All.run = function(apiStr) {
	var args = Array.prototype.slice.call(arguments, 1);
	return Promise.resolve().then(function() {
		var api = apiStr.split('.');
		var modName = api[0];
		var funName = api[1];
		var mod = All[modName];
		if (!mod) throw new HttpError.BadRequest(`Unknown api module ${modName}`);
		var fun = mod[funName];
		if (!fun) throw new HttpError.BadRequest(`Unknown api method ${funName}`);
		if (args.length != fun.length) {
			throw new HttpError.BadRequest(`Api method ${funName} expected ${fun.length} arguments, and got ${args.length} arguments`);
		}
		var data = args[args.length - 1] || {};
		try {
			args[args.length - 1] = check(fun, data);
		} catch(err) {
			console.error(`run ${apiStr} ${JSON.stringify(data)}`);
			throw err;
		}
		// start a transaction on set trx object on site
		var site = args.length == 2 ? args[0] : null;
		var hadTrx = false;
		return Promise.resolve().then(function() {
			if (!site) {
				return;
			}
			if (site.trx) {
				hadTrx = true;
				return;
			}
			return exports.transaction().then(function(trx) {
				site = args[0] = site.$clone();
				site.trx = trx;
			});
		}).then(function() {
			return fun.apply(mod, args);
		}).then(function(obj) {
			if (!hadTrx && site && site.trx) {
				try {
					return site.trx.commit().then(function() {
						return obj;
					});
				} catch(ex) {
					console.trace("bad trx.commit at", apiStr, ex);
				}
			}
			return obj;
		}).catch(function(err) {
			if (!hadTrx && site && site.trx) {
				try {
					return site.trx.rollback().then(function() {
						throw err;
					});
				} catch(ex) {
					console.trace("bad trx.rollback at", apiStr, ex);
				}
			} else {
				throw err;
			}
		});
	});
};

All.send = function(res, obj) {
	if (obj.cookies) {
		var host = All.domains.hosts[res.req.hostname];
		var cookieParams = {
			httpOnly: true,
			sameSite: true,
			secure: host && host.protocol == "https" || false,
			path: '/'
		};
		Object.keys(obj.cookies).forEach(function(key) {
			var cookie = obj.cookies[key];
			var val = cookie.value;
			var maxAge = cookie.maxAge;

			if (val == null || maxAge == 0) res.clearCookie(key, cookieParams);
			else res.cookie(key, val, Object.assign({}, cookieParams, {
				maxAge: maxAge
			}));
		});
		delete obj.cookies;
	}
	if (!obj.grants) {
		// because req.user is not set on the request setting the cookie
		// do not overwrite grants set by auth.login
		obj.grants = (res.req.user || {}).scopes || {};
	}
	if (obj.status) {
		res.status(obj.status);
		delete obj.status;
	}
	if (obj.location) {
		res.redirect(obj.location);
	} else {
		All.filter(res.req.site, (res.req.user || {}).scopes, obj);
		res.json(obj);
	}
};

All.filter = function(site, scopes, obj) {
	if (!obj.item && !obj.items) {
		return unlock(site, scopes, obj);
	}
	if (obj.item) {
		var item = unlock(site, scopes, obj.item, 'read');
		if (!item) throw new HttpError.Unauthorized("Insufficient permissions");
	}
	if (obj.items) obj.items = obj.items.filter(function(item) {
		return unlock(site, scopes, item, 'read');
	});
};

All.isLocked = isLocked;
All.unlock = unlock;

function isLocked(site, scopes, locks) {
	if (locks == null) return false;
	if (typeof locks == "string") locks = [locks];
	if (locks.length == 0) return false;
	if (!scopes) scopes = {};
	var maxIndex = -1;
	Object.keys(scopes).forEach(function(scope) {
		maxIndex = Math.max(site.$grants[scope] || maxIndex);
	});

	return !locks.some(function(lock) {
		var lockIndex = site.$grants[lock] || -1;
		return lockIndex < maxIndex || scopes[lock];
	});
}

function unlock(site, scopes, item, action) {
	if (!item.type) return item;
	if (item.children) {
		item.children = item.children.filter(function(item) {
			return unlock(site, scopes, item, action);
		});
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
	if (isLocked(site, scopes, locks['*'])) return;
	delete locks['*'];
	Object.keys(locks).forEach(function(path) {
		var list = locks[path];
		path = path.split('.');
		path.reduce(function(obj, val, index) {
			if (obj == null) return;
			if (index == path.length - 1) {
				if (isLocked(site, scopes, list)) delete obj[val];
			}
			return obj[val];
		}, item);
	});
	return item;
}


