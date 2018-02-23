var objection = require('objection');
var AjvKeywords = require('ajv-keywords');
var ajvApi = require('ajv')({
	$data: true,
	allErrors: true,
	validateSchema: true,
	ownProperties: true,
	coerceTypes: true,
	removeAdditional: true,
	useDefaults: true
});

var knex = require('knex');

var Path = require('path');
var pify = require('util').promisify;
var toSource = require('tosource');

var exec = pify(require('child_process').exec);

var fs = {
	readFile: pify(require('fs').readFile)
};
var vm = require('vm');

var debug = require('debug')('pageboard:api');

exports = module.exports = function(opt) {
	opt.plugins.unshift(
		__dirname + '/services/user',
		__dirname + '/services/site',
		__dirname + '/services/page',
		__dirname + '/services/block',
		__dirname + '/services/href',
		__dirname + '/services/form',
		__dirname + '/services/query'
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
	var dbOpt = knexConfig(opt);
	var knexInst = knex(dbOpt);
	objection.Model.createValidator = function() {
		return new objection.AjvValidator({
			onCreateAjv: function(ajv) {
				ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'));
				AjvKeywords(ajv, 'select');
			},
			options: {
				$data: true,
				allErrors: true,
				validateSchema: false,
				ownProperties: true,
				coerceTypes: true,
				removeAdditional: true
			}
		});
	};
	objection.Model.knex(knexInst);

	var models = {};
	opt.models.forEach(function(path) {
		var model = require(path);
		models[model.name] = model;
	});

	exports.objection = objection;
	exports.transaction = objection.transaction;
	exports.ref = objection.ref;
	exports.Model = objection.Model;
	exports.Href = models.Href;
	exports.models = models;

	exports.migrate = migrate.bind(null, knexInst, opt.migrations);
	exports.seed = seed.bind(null, knexInst, opt.seeds);
	exports.dump = dumpDb.bind(null, dbOpt.connection, opt);

	All.app.use('/.api/*', All.cache.tag('api'));

	All.app.get('/.api/elements.js', All.cache.tag('share', 'file'), All.query, function(req, res, next) {
		All.api.DomainBlock(req.query.domain).then(function(DomainBlock) {
			res.type('text/javascript');
			res.send('if (!window.Pageboard) window.Pageboard = {};\nPageboard.elements = ' + DomainBlock.source);
		}).catch(next);
	});

	// used by proxies to quickly know if this domain is known
	All.app.get('/.api', All.query, function(req, res, next) {
		All.domains.resolvable(req.query.domain).then(function() {
			return All.api.DomainBlock(req.query.domain).then(function(DomainBlock) {
				res.type('text').sendStatus(200);
			});
		}).catch(next);
	});
}

exports.check = function(fun, data) {
	if (!fun.schema) return data;
	if (!fun.validate) {
		fun.validate = ajvApi.compile(fun.schema);
	}
	// coerceTypes mutates data
	if (fun.validate(data)) {
		return data;
	} else {
		var messages = fun.validate.errors.map(x => x.message).join(',\n');
		throw new HttpError.BadRequest(`Bad api parameters: \n${messages}`);
	}
};

exports.install = function(domain, {elements, directories}, All) {
	debug("installing", domain, elements, directories);
	// TODO chicken and egg problem, we want to sort using the element priority
	// but we can't load it if it's not in the right order
	// besides that, mind that elements are already ordered in their directory by core initConfig
	var eltsMap = {};
	var allDirs = domain ? All.opt.directories.concat(directories) : directories;
	var allElts = domain ? All.opt.elements.concat(elements) : elements;
	return Promise.all(allElts.map(function(path) {
		return importElements(path, eltsMap, domain, allDirs);
	})).then(function() {
		var Block = exports.models.Block.extendSchema(domain, eltsMap);
		Block.elements = eltsMap;
		if (domain) {
			Block.domain = domain;
			Block.source = toSource(Object.assign({}, exports.Block.elements, Block.elements));
			return All.domains.block(domain, Block);
		} else {
			exports.Block = All.api.Block = Block;
			Block.source = toSource(Block.elements);
		}
	});
};

exports.DomainBlock = function(domain) {
	var Block = All.domains.block(domain);
	if (Block) return Promise.resolve(Block);
	return All.site.get({domain: domain}).then(function(site) {
		return All.install(site.data);
	});
};

function promotePath(dir, path) {
	if (!path) return;
	if (path.startsWith('/') || /^(http|https|data):/.test(path)) return path;
	return Path.join(dir, path);
}

function removeEmptyPath(what, name, path) {
	if (!path) {
		console.warn("element", name, "has empty", what);
		return false;
	} else {
		return true;
	}
}

function rewriteElementPaths(name, path, elt, domain, directories) {
	var mount = directories.find(function(mount) {
		return path.startsWith(mount.from);
	});
	if (!mount) {
		console.warn(`Warning: element ${path} cannot be mounted`);
		return;
	}
	var basePath = domain ? mount.to.replace(domain + "/", "") : mount.to;
	var eltPathname = Path.join(basePath, path.substring(mount.from.length));
	var eltDirPath = Path.dirname(eltPathname);
	var promotePathFn = promotePath.bind(null, eltDirPath);
	if (elt.scripts != null) {
		if (typeof elt.scripts == "string") elt.scripts = [elt.scripts];
		elt.scripts = elt.scripts.map(promotePathFn)
		.filter(removeEmptyPath.bind(null, 'scripts', name));
	} else {
		delete elt.scripts;
	}
	if (elt.stylesheets != null) {
		if (typeof elt.stylesheets == "string") elt.stylesheets = [elt.stylesheets];
		elt.stylesheets = elt.stylesheets.map(promotePathFn)
		.filter(removeEmptyPath.bind(null, 'scripts', name));
	} else {
		delete elt.stylesheets;
	}
	if (elt.helpers != null) {
		if (typeof elt.helpers == "string") elt.helpers = [elt.helpers];
		elt.helpers = elt.helpers.map(promotePathFn)
		.filter(removeEmptyPath.bind(null, 'scripts', name));
	} else {
		delete elt.helpers;
	}
}

function importElements(path, eltsMap, domain, directories) {
	return fs.readFile(path).then(function(buf) {
		var script = new vm.Script(buf, {filename: path});
		var copyMap = Object.assign({}, eltsMap);
		var sandbox = {Pageboard: {elements: copyMap}};
		try {
			script.runInNewContext(sandbox, {filename: path, timeout: 1000});
		} catch(ex) {
			console.error(`Error trying to install element ${path}: ${ex}`);
			return;
		}
		var elts = sandbox.Pageboard.elements;
		var elt, oelt;
		for (var name in elts) {
			elt = elts[name];
			oElt = eltsMap[name];
			if (oElt) {
				if (name == "user" || name == "site") {
					continue;
				}
			}
			rewriteElementPaths(name, path, elt, domain, directories);
			eltsMap[name] = elt;
		}
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

function dumpDb(conn, opt) {
	var stamp = (new Date).toISOString().split('.')[0].replace(/[-:]/g, '');
	var file = Path.join(opt.database.dump.dir, `${opt.name}-${stamp}.dump`);
	return exec(`pg_dump --format=custom --file=${file} --username=${conn.user} ${conn.database}`, {}).then(function() {
		return file;
	});
}

function knexConfig(config) {
	if (!process.env.HOME) process.env.HOME = require('passwd-user').sync(process.getuid()).homedir;
	var dbOpts = Object.assign({}, {
		url: `postgres://localhost/${opt.name}`
	}, config.database);
	delete dbOpts.dump;
	var parsed = require('url').parse(dbOpts.url, true);
	delete dbOpts.url;
	var conn = {};
	var obj = { connection: conn };
	if (parsed.host) conn.host = parsed.host;
	if (parsed.pathname) conn.database = parsed.pathname.substring(1);
	if (parsed.auth) {
		var auth = parsed.auth.split(':');
		conn.user = auth[0];
		if (auth.length > 1) conn.password = auth[1];
	}
	if (parsed.protocol) obj.client = parsed.protocol.slice(0, -1);
	if (dbOpts.client) {
		obj.client = dbOpts.client;
		delete dbOpts.client;
	}
	obj.debug = require('debug').enabled('pageboard:sql');
	if (dbOpts.debug) {
		obj.debug = dbOpts.debug;
		delete dbOpts.debug;
	}
	Object.assign(conn, dbOpts);
	return obj;
}

var gcTimeout;
exports.gc = function(All) {
	var opts = All.opt.gc;
	if (!opts) opts = All.opt.gc = {};
	var blockDays = parseInt(opts.block);
	if (isNaN(blockDays)) blockDays = 1;
	var hrefDays = parseInt(opts.href);
	if (isNaN(hrefDays)) hrefDays = 7;
	opts.block = blockDays;
	opts.href = hrefDays;

	var interval = Math.max(Math.min(blockDays, hrefDays), 1) * 24 * 60 * 60 * 1000;
	var jump = gcTimeout == null;
	gcTimeout = setTimeout(exports.gc.bind(null, All), interval);
	if (jump) return;

	return Promise.all([
		All.block.gc(blockDays),
		All.href.gc(hrefDays)
	]).then(function([blockResult, hrefResult]) {
		if (blockResult.length) {
			console.info(`gc: ${blockResult.length} blocks since ${blockDays} days`);
		}
		if (hrefResult.length) {
			console.info(`gc: ${hrefResult.length} hrefs since ${hrefDays} days`);
		}
		return Promise.all(hrefResult.map(function(obj) {
			if (obj.type == "link") return Promise.resolve();
			return All.upload.gc(obj.hostname, obj.pathname).catch(function(ex) {
				console.error("gc error", obj.domain, obj.url, ex);
			});
		}));
	});
};
