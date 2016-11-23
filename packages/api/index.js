var objection = require('objection');
var ObjectionRest = require('objection-rest');
var knex = require('knex');

exports = module.exports = function(opt) {
	opt.plugins.unshift(__dirname + '/services/page');
	opt.components = [];
	opt.models = [
		__dirname + '/models/site',
		__dirname + '/models/block'
	];
	opt.seeds = [__dirname + '/seeds'];
	opt.migrations = [__dirname + '/migrations'];
	return {
		service: init
	}
};

function init(All) {
	var opt = All.opt;
	var knexInst = knex(knexConfig(opt));
	objection.Model.knex(knexInst);

	var models = {};
	opt.models.forEach(function(path) {
		var model = require(path);
		models[model.name] = model;
	});
	Object.assign(exports, models);

	exports.Block.initComponents(opt.components);
	exports.objection = objection;
	exports.db = {
		migrate: migrate.bind(null, knexInst, opt.migrations),
		seed: seed.bind(null, knexInst, opt.seeds)
	};

	var rest = ObjectionRest(objection).routePrefix('/api');
	Object.keys(models).forEach(function(name) {
		rest.addModel(models[name]);
	});
	rest.generate(All.app);

	var p = Promise.resolve();
	if (opt._.includes("migrate")) {
		p = p.then(exports.db.migrate);
	}
	if (opt._.includes("seed")) {
		p = p.then(exports.db.seed);
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

