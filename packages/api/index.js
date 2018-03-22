var objection = require('objection');
var AjvKeywords = require('ajv-keywords');
var bodyParserJson = require('body-parser').json();
var schedule = require('node-schedule');

var ajvApi = require('ajv')({
	$data: true,
	allErrors: true,
	validateSchema: true,
	ownProperties: true,
	coerceTypes: 'array',
	removeAdditional: false,
	useDefaults: true
});
ajvApi.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'));

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
				coerceTypes: 'array',
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

	All.app.get('/.api/elements.js',
		All.cache.tag('share', 'file').for('5s'),
		function(req, res, next) {
			res.type('text/javascript');
			var source = req.site.Block.source;
			res.send('if (!window.Pageboard) Pageboard = {};\nPageboard.elements = ' + source);
		}
	);

	All.app.use('/.api/*', All.cache.tag('api'), bodyParserJson);
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
		var messages = fun.validate.errors.map(function(err) {
			if (err.dataPath) return `${err.dataPath} ${err.message}`;
			else return err.message;
		}).join(',\n');
		throw new HttpError.BadRequest(`Bad api parameters: \n${messages}`);
	}
};

exports.install = function(site, {elements, directories}, All) {
	debug("installing", id, elements, directories);
	// TODO chicken and egg problem, we want to sort using the element priority
	// but we can't load it if it's not in the right order
	// besides that, mind that elements are already ordered in their directory by core initConfig
	var eltsMap = {};
	var id = site ? site.id : null;
	var allDirs = id ? All.opt.directories.concat(directories) : directories;
	var allElts = id ? All.opt.elements.concat(elements) : elements;
	return Promise.all(allElts.map(function(path) {
		return importElements(path, eltsMap, id, allDirs);
	})).then(function() {
		var Block = exports.models.Block.extendSchema(id, eltsMap);
		if (id) {
			return preparePage(site, eltsMap).then(function() {
				Block.source = toSource(eltsMap);
				site.Block = Block;
			});
		} else {
			exports.Block = All.api.Block = Block;
		}
	});
};

function preparePage(site, elts) {
	var prod = site.data.production;
	var list = Object.keys(elts).map(function(key) {
		var el = elts[key];
		if (!el.name) el.name = key;
		return el;
	}).sort(function(a, b) {
		return (a.priority || 0) - (b.priority || 0);
	});
	elts.page = Object.assign({}, elts.page);
	var scripts = filter(list, 'scripts');
	var styles = filter(list, 'stylesheets');
	if (!prod) {
		elts.page.scripts = scripts;
		elts.page.stylesheets = styles;
		return Promise.resolve();
	}
	var version = site.data.version;
	if (version == null) {
		version = site.data.module.split('#');
		if (version.length == 2) version = version.pop();
		else version = '0';
	}
	return Promise.all([
		All.statics.bundle(site, scripts, `scripts-${version}.js`),
		All.statics.bundle(site, styles, `styles-${version}.css`)
	]).then(function(both) {
		elts.page.scripts = [both[0]];
		elts.page.stylesheets = [both[1]];
	});
}

function filter(elements, prop) {
	var map = {};
	var res = [];
	elements.forEach(function(el) {
		var list = el[prop];
		if (!list) return;
		delete el[prop];
		if (typeof list == "string") list = [list];
		var url, prev;
		for (var i=0; i < list.length; i++) {
			url = list[i];
			prev = map[url];
			if (prev) {
				if (el.priority != null) {
					if (prev.priority == null) {
						// move prev url on top of res
						res = res.filter(function(lurl) {
							return lurl != url;
						});
					} else if (prev.priority != el.priority) {
						console.warn(prop, url, "declared in element", el.name, "with priority", el.priority, "is already declared in element", prev.name, "with priority", prev.priority);
						continue;
					} else {
						continue;
					}
				} else {
					continue;
				}
			}
			map[url] = el;
			res.push(url);
		}
	});
	return res;
}

function promotePath(dir, path) {
	if (!path) return;
	if (path.startsWith('/') || /^(http|https|data):/.test(path)) return path;
	return Path.join(dir, path);
}

function removeEmptyPath(what, name, path) {
	if (!path) {
		console.warn(`${name}.${what} does not resolve to a path`);
		return false;
	} else {
		return true;
	}
}

function rewriteElementPaths(name, path, elt, id, directories) {
	var mount = directories.find(function(mount) {
		return path.startsWith(mount.from);
	});
	if (!mount) {
		console.warn(`Warning: element ${path} cannot be mounted`);
		return;
	}
	var basePath = id ? mount.to.replace(id + "/", "") : mount.to;
	var eltPathname = Path.join(basePath, path.substring(mount.from.length));
	var eltDirPath = Path.dirname(eltPathname);
	var promotePathFn = promotePath.bind(null, eltDirPath);
	['scripts', 'stylesheets', 'resources'].forEach(function(what) {
		if (elt[what] != null) {
			if (typeof elt[what] == "string") elt[what] = [elt[what]];
			elt[what] = elt[what].map(promotePathFn)
			.filter(removeEmptyPath.bind(null, what, name));
		} else {
			delete elt[what];
		}
	});
}

function importElements(path, eltsMap, id, directories) {
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
			rewriteElementPaths(name, path, elt, id, directories);
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

var gcJob;
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
	var jump = gcJob == null;
	gcJob = schedule.scheduleJob(new Date(Date.now() + interval), exports.gc.bind(null, All));
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
			return All.upload.gc(obj.site, obj.pathname).catch(function(ex) {
				console.error("gc error", obj.id, obj.url, ex);
			});
		}));
	});
};
