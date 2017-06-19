var objection = require('objection');
var knex = require('knex');

var Path = require('path');
var pify = require('util').promisify;
var equal = require('esequal');

var fs = {
	readFile: pify(require('fs').readFile)
};
var vm = require('vm');

exports = module.exports = function(opt) {
	if (!opt.database) opt.database = `postgres://localhost/${opt.name}`;

	opt.plugins.unshift(
		__dirname + '/services/user',
		__dirname + '/services/site',
		__dirname + '/services/page',
//		__dirname + '/services/block',
		__dirname + '/services/href'
	);
	opt.models = [
		__dirname + '/models/block',
		__dirname + '/models/href'
	];
	opt.seeds = [__dirname + '/seeds'];
	opt.migrations = [__dirname + '/migrations'];
	return {
		name: 'api',
		service: init
	};
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

	exports.Href = models.Href;
	exports.objection = objection;
	exports.migrate = migrate.bind(null, knexInst, opt.migrations);
	exports.seed = seed.bind(null, knexInst, opt.seeds);
	exports.blocksByDomain = {};
}

exports.install = function({elements, directories, domain}) {
	var schemas = {};
	return Promise.all(elements.map(function(path) {
		return populateSchemas(path, schemas);
	})).then(function() {
		var Block = exports.models.Block.extendSchema(schemas);
		if (domain) {
			exports.blocksByDomain[domain] = Block;
		} else {
			exports.Block = All.api.Block = Block;
		}
		if (!domain) return;

		return All.site.get({domain:domain}).then(function(site) {
			var paths = [];
			elements.forEach(function(path) {
				var mount = directories.find(function(mount) {
					return path.startsWith(mount.from);
				});
				if (!mount) {
					console.warn(`Warning: element ${path} cannot be mounted`);
				} else {
					paths.push(path.substring(mount.from.length));
				}
			});
			if (!equal(site.data.elements, paths)) {
				site.data.elements = paths;
				return All.site.save(site);
			}
		});
	});
};

exports.DomainBlock = function(domain) {
	if (exports.blocksByDomain[domain]) return Promise.resolve(exports.blocksByDomain[domain]);
	return All.api.site.get({domain: domain}).then(function(site) {
		if (!site) throw new Error("Site not found");
		return All.install(site.data).then(function() {
			return exports.blocksByDomain[domain];
		});
	});
};

function populateSchemas(path, schemas) {
	return fs.readFile(path).then(function(buf) {
		var script = new vm.Script(buf, {filename: path});
		var sandbox = {Pageboard: {elements: {}}};
		try {
			script.runInNewContext(sandbox, {filename: path, timeout: 1000});
		} catch(ex) {
			console.error(`Error trying to install element ${path}: ${ex}`);
			return;
		}
		Object.assign(schemas, sandbox.Pageboard.elements);
	}).catch(function(err) {
		console.error(`Error inspecting element path ${path}`, err);
	});
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

