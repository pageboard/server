var objection = require('objection');
var ObjectionRest = require('objection-rest');
var knex = require('knex');


exports.service = function(app, api, config) {
	config.components = [];
	config.models = [
		__dirname + '/models/site',
		__dirname + '/models/block'
	];
	config.seeds = [__dirname + '/seeds'];
	config.migrations = [__dirname + '/migrations'];
	return init;
};

function init(app, api, config) {
	var knexInst = knex(knexConfig(config));
	objection.Model.knex(knexInst);

	var models = {};
	config.models.forEach(function(path) {
		var model = require(path);
		models[model.name] = model;
	});

	models.Block.initComponents(config.components);

	api.migrate = function() {
		migrate(knexInst, config.migrations);
	};
	api.seed = function() {
		seed(knexInst, config.seeds);
	};

	var rest = ObjectionRest(objection).routePrefix('/api');
	Object.keys(models).forEach(function(name) {
		rest.addModel(models[name]);
	});
	rest.generate(app);
}

function migrate(knex, dirs) {
	return Promise.all(dirs.map(function(dir) {
		return knex.migrate.latest({
			directory: dir
		});
	}));
}

function seed(knex, dirs) {
	return Promise.all(dirs.map(function(dir) {
		return knex.seed.run({
			directory: dir
		});
	}));
}

function knexConfig(config) {
	if (!process.env.HOME) process.env.HOME = require('passwd-user').sync(process.getuid()).homedir;
	var parsed = require('url').parse(config.database, true);
	var conn = {};
	var obj = { connection: conn };
	if (parsed.host) conn.host = parsed.host;
	if (parsed.pathname) conn.database = parsed.pathname.substring(1);
	if (parsed.auth) {
		var auth = parsed.auth.split(':');
		conn.user = auth[0];
		if (auth.length > 1) conn.password = auth[1];
	}
	obj.client = parsed.protocol.slice(0, -1);
	obj.debug = !!parseInt(parsed.query.debug);
	return obj;
}

