var objection = require('objection');
var knex = require('knex');

var ajv = require('ajv');
var AjvKeywords = require('ajv-keywords');
var ajvMetaSchema = require('ajv/lib/refs/json-schema-draft-06.json');

var bodyParserJson = require('body-parser').json();

var dba = require('./lib/dba');
var imports = require('./lib/imports');
var utils = require('./lib/utils');


var ajvApiSettings = {
	$data: true,
	allErrors: true,
	validateSchema: true,
	ownProperties: true,
	coerceTypes: 'array',
	removeAdditional: false,
	formats: {
		singleline: {
			pattern: /^[^\n\r]*$/
		}
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

	objection.Model.createValidator = function() {
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
				removeAdditional: false,
				formats: ajvApiSettings.formats
			}
		});
	};
	objection.Model.knex(knexInst);

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
	All.app.use('/.api/*', All.auth.restrict('*'), All.cache.tag('data-:site'), bodyParserJson);
}

exports.check = function(fun, data) {
	if (!fun.schema) return data;
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
};

