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
	},
	invalidDefaults: 'log'
};
var ajvApiWithDefaults = AjvKeywords(ajv(Object.assign({}, ajvApiSettings, {
	useDefaults: 'empty'
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
				ajv.addKeyword('coerce', {
					modifying: true,
					type: 'string',
					validate: function(schema, data, parentSchema, path, parent, name) {
						if (data == null) return true;
						var format = parentSchema.format;
						if (format != "date" && format != "time" && format != "date-time") return true;
						var d = new Date(data);
						if (isNaN(d.getTime())) {
							parent[name] = null;
						} else {
							data = d.toISOString();
							if (format == "date") parent[name] = data.split('T').shift();
							else if (format == "time") parent[name] = data.split('T').pop();
							else if (format == "date-time") parent[name] = data;
						}
						return true;
					}
				});
				// otherwise the `format` keyword would validate before `coerce`
				// https://github.com/epoberezkin/ajv/issues/986
				var rules = ajv.RULES.types.string.rules;
				rules.unshift(rules.pop());
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

	// api depends on site files, that tag is invalidated in cache install
	All.app.get('/.api/*', All.cache.tag('app-:site'));
	All.app.use('/.api/*',
		function(req, res, next) {
			if (req.site.data.maintenance === true && req.method != "GET") {
				throw new HttpError.ServiceUnavailable("Site is in maintenance mode");
			} else {
				next();
			}
		},
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

All.run = function(apiStr, req, data) {
	return Promise.resolve().then(function() {
		var api = apiStr.split('.');
		var modName = api[0];
		var funName = api[1];
		var mod = All[modName];
		if (!mod) throw new HttpError.BadRequest(`Unknown api module ${modName}`);
		var fun = mod[funName];
		if (!fun) throw new HttpError.BadRequest(`Unknown api method ${funName}`);
		if (req && data === undefined && fun.length == 1) {
			data = req;
			req = null;
		}
		if (data == null) data = {};
		try {
			data = check(fun, data);
		} catch(err) {
			err.message += require('./lib/json-doc')(fun.schema);
			throw err;
		}
		// start a transaction on set trx object on site
		var hadTrx = false;
		var site = req ? req.site : null;
		return Promise.resolve().then(function() {
			if (!site) {
				return;
			}
			if (site.trx) {
				hadTrx = true;
				return;
			}
			return exports.transaction().then(function(trx) {
				site = req.site = site.$clone();
				site.trx = trx;
			});
		}).then(function() {
			var args = [data];
			if (req) args.unshift(req);
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
			console.error("api method:", apiStr);
			if (req && req.user && req.user.id) console.error("by user", req.user.id, req.user.grants);
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
	var req = res.req;
	if (obj == null || typeof obj != "object") {
		console.trace("All.send expects an object, got", obj);
		obj = {};
	}
	if (obj.cookies) {
		var host = All.domains.hosts[req.hostname];
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
	// client needs to know what keys are supposed to be available
	obj.grants = {};
	(req.user.grants || []).forEach(function(grant) {
		obj.grants[grant] = true;
	});
	if (obj.status) {
		res.status(obj.status);
		delete obj.status;
	}
	if (obj.location) {
		res.redirect(obj.location);
	} else {
		All.auth.filterResponse(req, obj);
		All.auth.headers(res, req.locks);
		res.json(obj);
	}
};


