const { transaction, AjvValidator } = require('objection');

const ajv = require('ajv');
const AjvKeywords = require('ajv-keywords');

const bodyParser = require.lazy('body-parser');
const jsonPath = require.lazy('@kapouer/path');

const install = require('./lib/install');
const utils = require('./lib/utils');
const common = require('./models/common');
const jsonDoc = require.lazy('./lib/json-doc');

const ajvApiSettings = {
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
		id: /^[A-Za-z0-9]+$/,
		name: /^\w+$/,
		grant: /^[a-z0-9-]+$/
	},
	invalidDefaults: 'log'
};
const ajvApiWithDefaults = AjvKeywords(ajv(Object.assign({}, ajvApiSettings, {
	useDefaults: 'empty'
})));

const ajvApiWithNoDefaults = AjvKeywords(ajv(Object.assign({}, ajvApiSettings, {
	useDefaults: false
})));

exports = module.exports = function (opt) {
	opt.plugins.unshift(
		__dirname + '/services/user',
		__dirname + '/services/site',
		__dirname + '/services/archive',
		__dirname + '/services/settings',
		__dirname + '/services/page',
		__dirname + '/services/block',
		__dirname + '/services/href',
		__dirname + '/services/form',
		__dirname + '/services/query',
		__dirname + '/services/reservation'
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
	const opt = All.opt;

	common.Model.createValidator = function () {
		return new AjvValidator({
			onCreateAjv: function (ajv) {
				AjvKeywords(ajv);
				ajv.addKeyword('coerce', {
					modifying: true,
					type: 'string',
					errors: false,
					validate: function (schema, data, parentSchema, path, parent, name) {
						if (data == null) return true;
						const format = parentSchema.format;
						if (parentSchema.type == "string" && data === "") {
							if (parentSchema.default !== undefined) {
								parent[name] = parentSchema.default;
							} else if (parentSchema.nullable) {
								delete parent[name];
							}
							return true;
						}
						if (format != "date" && format != "time" && format != "date-time") return true;
						const d = new Date(data);
						if (Number.isNaN(d.getTime())) {
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
				const rules = ajv.RULES.types.string.rules;
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

	const models = {};
	opt.models.forEach((path) => {
		const model = require(path);
		models[model.name] = model;
	});

	exports.Href = models.Href;
	exports.Block = models.Block;

	Object.keys(utils).forEach((key) => {
		if (All.utils[key]) throw new Error(`Cannot reassign All.utils.${key}`);
		All.utils[key] = utils[key];
	});

	Object.assign(exports, install);

	// api depends on site files, that tag is invalidated in cache install
	All.app.get('/.api/*', All.cache.tag('app-:site'));
	All.app.use('/.api/*',
		(req, res, next) => {
			if (req.site.data.maintenance === true && req.method != "GET") {
				throw new HttpError.ServiceUnavailable("Site is in maintenance mode");
			} else {
				next();
			}
		},
		// invalid site by site
		All.cache.tag('data-:site'),
		// parse json bodies
		bodyParser.json({ limit: '1000kb' })
	);
}


function check(fun, schema, data) {
	if (!schema || schema.additionalProperties) return data;
	if (!fun.validate) {
		if (schema.defaults === false) {
			fun.validate = ajvApiWithNoDefaults.compile(schema);
		} else {
			fun.validate = ajvApiWithDefaults.compile(schema);
		}
	}
	// coerceTypes mutates data
	if (fun.validate(data)) {
		return data;
	} else {
		const messages = fun.validate.errors.map((err) => {
			if (err.dataPath) return `${err.dataPath} ${err.message}`;
			else return err.message;
		}).join(',\n');
		throw new HttpError.BadRequest(`Bad api parameters: \n${messages}`);
	}
}

function getApiMethodSchema(apiStr) {
	const [modName, funName] = apiStr.split('.');
	const mod = All.services[modName];
	if (!mod) throw new HttpError.BadRequest(Text`
		Unknown api module ${modName}
			${Object.getOwnPropertyNames(All.services).sort().join(', ')}
	`);
	const schema = mod[funName];
	const fun = All[modName][funName];
	if (!fun) throw new HttpError.BadRequest(Text`
		Unknown api method ${apiStr}
			${Object.getOwnPropertyNames(mod).sort().join(', ')}
	`);
	if (!schema) throw new HttpError.BadRequest(`Internal api method ${apiStr}`);
	return [schema, mod, fun];
}

All.help = function (apiStr) {
	const [schema] = getApiMethodSchema(apiStr);
	return require('./lib/json-doc')(schema);
};

All.run = function (apiStr, req, data) {
	return Promise.resolve().then(() => {
		const [schema, mod, fun] = getApiMethodSchema(apiStr);
		if (fun.length == 1 && data == null) {
			data = req;
			req = null;
		}
		Log.api("run %s:\n%O", apiStr, data);
		try {
			data = check(fun, schema, data);
		} catch (err) {
			err.message += '\n ' + apiStr + '\n' + jsonDoc(All.opt, schema);
			throw err;
		}
		// start a transaction on set trx object on site
		let hadTrx = false;
		return Promise.resolve().then(() => {
			if (!req) {
				return;
			} else if (req.trx) {
				hadTrx = true;
				return;
			}
			return transaction.start(All.db.tenant(req.tenant)).then((trx) => {
				req.trx = trx;
			});
		}).then(() => {
			const args = [data];
			if (req) args.unshift(req);
			return fun.apply(mod, args);
		}).then((obj) => {
			if (!hadTrx && req && req.trx && !req.trx.isCompleted()) {
				return req.trx.commit().then(() => {
					return obj;
				});
			} else {
				return obj;
			}
		}).catch((err) => {
			Log.api("error %s:\n%O", apiStr, err);
			throw err;
		}).finally(() => {
			if (!req || !req.trx) return;
			if (req.trx.isCompleted()) {
				if (hadTrx) {
					return transaction.start(All.db.tenant(req.tenant))
						.then((trx) => {
							req.trx = trx;
						});
				} else {
					delete req.trx;
				}
			} else if (!hadTrx) {
				return req.trx.rollback();
			}
		});
	});
};

All.send = function (res, obj) {
	const req = res.req;
	if (obj == null || typeof obj != "object") {
		// eslint-disable-next-line no-console
		console.trace("All.send expects an object, got", obj);
		obj = {};
	}
	if (obj.cookies) {
		const cookieParams = {
			httpOnly: true,
			sameSite: true,
			secure: req.site.url.protocol == "https:",
			path: '/'
		};
		Object.keys(obj.cookies).forEach((key) => {
			const cookie = obj.cookies[key];
			const val = cookie.value;
			const maxAge = cookie.maxAge;

			if (val == null || maxAge == 0) res.clearCookie(key, cookieParams);
			else res.cookie(key, val, Object.assign({}, cookieParams, {
				maxAge: maxAge
			}));
		});
		delete obj.cookies;
	}
	// client needs to know what keys are supposed to be available
	obj.grants = {};
	(req.user.grants || []).forEach((grant) => {
		obj.grants[grant] = true;
	});
	if (obj.status) {
		res.status(obj.status);
		delete obj.status;
	}

	obj = All.auth.filterResponse(req, obj, itemFn);
	if (obj.item && !obj.item.type) {
		// 401 Unauthorized: missing or bad authentication
		// 403 Forbidden: authenticated but not authorized
		res.status(req.user.id ? 403 : 401);
	}
	if (req.granted) res.set('X-Granted', 1);
	All.auth.headers(res, req.locks);
	res.json(obj);
};

function itemFn(schema, block) {
	if (schema.upgrade) {
		Object.entries(schema.upgrade).forEach(([src, dst]) => {
			const val = jsonPath.get(block, src);
			if (val !== undefined) {
				jsonPath.set(block, dst, val);
				jsonPath.unSet(block, src);
			}
		});
	}
}
