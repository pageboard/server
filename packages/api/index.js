var objection = require('objection');
var ObjectionRest = require('objection-rest');
var knex = require('knex');


module.exports = function(plugins) {
	plugins.services.push(init.bind(plugins));
	plugins.components = [];
	plugins.models = [
		__dirname + '/models/site',
		__dirname + '/models/block'
	];
	plugins.seeds = [__dirname + '/seeds'];
	plugins.migrations = [__dirname + '/migrations'];
};

function init(app, api, config) {
	var knexInst = knex(knexConfig(config));
	objection.Model.knex(knexInst);

	this.models.forEach(function(path) {
		require(path);
	});
	console.log(objection);

	//objection.models.Block.initComponents(this.components);

	api.migrate = function() {
		migrate(knexInst, plugins.migrations);
	};
	api.seed = function() {
		seed(knexInst, plugins.seeds);
	};

	// what to do exactly with models ? require them all ?
	// components should be used to
	// 1) fill block schema when applicable
	// 2) install front-end component

	//ObjectionRest(objection)
	//	.routePrefix('/api')
	//	.addModel(require('./models/site'))
	//	.addModel(require('./models/block'))
	//	.generate(app);
};

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

