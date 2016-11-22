var objection = require('objection');
var ObjectionRest = require('objection-rest');
var knex = require('knex');

module.exports = function(config) {
	config.components = [];
	config.models = [
		__dirname + '/models/site',
		__dirname + '/models/block'
	];
	config.seeds = [__dirname + '/seeds'];
	config.migrations = [__dirname + '/migrations'];
	return {
		name: 'api',
		service: init
	}
};

function init(app, modules, config) {
	var knexInst = knex(knexConfig(config));
	objection.Model.knex(knexInst);

	var models = {};
	config.models.forEach(function(path) {
		var model = require(path);
		models[model.name] = model;
	});

	models.Block.initComponents(config.components);
	exports.models = models;
	exports.objection = objection;
	exports.migrate = migrate.bind(null, knexInst, config.migrations);
	exports.seed = seed.bind(null, knexInst, config.seeds);

	var rest = ObjectionRest(objection).routePrefix('/api');
	Object.keys(models).forEach(function(name) {
		rest.addModel(models[name]);
	});
	rest.generate(app);

	var p = Promise.resolve();
	if (config._.includes("migrate")) {
		p = p.then(exports.migrate);
	}
	if (config._.includes("seed")) {
		p = p.then(exports.seed);
	}
	return p;
}

function migrate(knex, dirs) {
	return Promise.all(dirs.map(function(dir) {
		console.info("Running knex:migrate in", dir);
		return knex.migrate.latest({
			directory: dir
		}).spread(function(batchNo, list) {
			if (list.length) console.log(" ", list.join("\n "));
		});
	}));
}

function seed(knex, dirs) {
	return Promise.all(dirs.map(function(dir) {
		console.info("Running knex:seed");
		return knex.seed.run({
			directory: dir
		}).spread(function(list) {
			if (list.length) console.log(" ", list.join("\n "));
			else console.log("No seed files in", dir);
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

