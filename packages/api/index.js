var objection = require('objection');
var knex = require('knex');
var fs = require('fs');
var Path = require('path');

exports = module.exports = function(opt) {
	if (!opt.database) opt.database = `postgres://localhost/${opt.name}`;

	opt.plugins.unshift(
		__dirname + '/services/user',
		__dirname + '/services/site',
		__dirname + '/services/page',
		__dirname + '/services/block',
		__dirname + '/services/href'
	);
	opt.statics.mounts.push(__dirname + '/public');
	opt.models = [
		__dirname + '/models/block',
		__dirname + '/models/href'
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
	console.info("Models:");
	opt.models.forEach(function(path) {
		var model = require(path);
		console.info(" ", model.name);
		models[model.name] = model;
	});
	Object.assign(exports, models);

	opt.schemas = {};
	opt.elements.forEach(function(path) {
		var element = require(path);
		var type = element.name || Path.basename(path);
		var prev = opt.schemas[type];
		if (prev) Object.assign(prev, element);
	});
	exports.Block.extendSchema(opt.schemas);
	exports.objection = objection;
	exports.migrate = migrate.bind(null, knexInst, opt.migrations);
	exports.seed = seed.bind(null, knexInst, opt.seeds);
}



function migrate(knex, dirs) {
	return Promise.all(dirs.map(function(dir) {
		console.info(` ${dir}`);
		return knex.migrate.latest({
			directory: dir
		}).spread(function(batchNo, list) {
			if (list.length) return list;
			return "No migrations run in this directory";
		});
	}));
}

function seed(knex, dirs) {
	return Promise.all(dirs.map(function(dir) {
		console.info(` ${dir}`);
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
	if (config.connection) {
		if (config.connection.client) {
			obj.client = config.connection.client;
			delete config.connection.client;
		}
		if (config.connection.debug) {
			obj.debug = config.connection.debug;
			delete config.connection.debug;
		}
		Object.assign(conn, config.connection);
	}
	return obj;
}

