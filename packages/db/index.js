const Path = require('path');
const pify = require('util').promisify;
const exec = pify(require('child_process').exec);
const Cron = require.lazy("cron");
const fs = require('fs').promises;
const knex = require('knex');


exports = module.exports = function() {
	return {
		name: 'db',
		priority: -100,
		service: init
	};
};

function init(All) {
	var opt = All.opt;
	opt.db = knexConfig(opt);
	exports.knex = knex(opt.db);
	if (Object.keys(opt.upstreams)[0] == opt.version) initDumps(All);
	// TODO Cron exports.gc...
}

exports.migrate = function() {
	var opt = All.opt;
	var dirs = opt && opt.migrations || null;
	if (!dirs) throw new Error("Missing `migrations` directory option");
	return Promise.all(dirs.map(function(dir) {
		console.info(` ${dir}`);
		return exports.knex.migrate.latest({
			directory: dir
		}).spread(function(batchNo, list) {
			if (list.length) return list;
			return "No migrations run in this directory";
		});
	}));
};

exports.seed = function() {
	var opt = All.opt;
	var dirs = opt && opt.seeds || null;
	if (!dirs) throw new Error("Missing `seeds` directory option");
	return Promise.all(dirs.map(function(dir) {
		console.info(` ${dir}`);
		return exports.knex.seed.run({
			directory: dir
		}).spread(function(list) {
			if (list.length) console.log(" ", list.join("\n "));
			else console.log("No seed files in", dir);
		});
	}));
};

exports.dump = function(stamp) {
	var opt = All.opt;
	var dumpDir = opt.database.dump && opt.database.dump.dir;
	if (!dumpDir) throw new HttpError.BadRequest("Missing database.dump.dir config");
	var file = Path.join(dumpDir, `${opt.db.database}-${stamp}.dump`);
	return exec(`pg_dump --format=custom --file=${file} --username=${opt.db.user} ${opt.db.database}`, {}).then(function() {
		return file;
	});
};

exports.restore = function(stamp) {
	var opt = All.opt;
	var dumpDir = opt.database.dump && opt.database.dump.dir;
	if (!dumpDir) throw new HttpError.BadRequest("Missing database.dump.dir config");
	var db = `${opt.db.database}-${stamp}`;
	var file = Path.join(dumpDir, `${db}.dump`);
	return exec(`createdb -U ${opt.db.user} -T template1 ${db}`, {}).then(function() {
		return exec(`pg_restore -d ${db} -U ${opt.db.user} ${file}`, {}).then(function() {
			return file;
		});
	}).catch(function(err) {
		return exec(`dropdb -U ${opt.db.user} ${db}`, {});
	});
};

function knexConfig(opt) {
	if (!process.env.HOME) process.env.HOME = require('passwd-user').sync().homeDirectory;
	var dbName = opt.database.name || opt.name;
	var dbOpts = Object.assign({}, {
		url: `postgres://localhost/${dbName}`
	}, opt.database);
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
	if (opt.env == "development") {
		obj.asyncStackTraces = true;
	}
	Object.assign(conn, dbOpts);
	return obj;
}

/*
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
*/

function initDumps(All) {
	var opt = All.opt.database.dump;
	if (!opt) return;
	var day = 1000 * 60 * 60 * 24;
	opt = All.opt.database.dump = Object.assign({
		interval: 1,
		dir: Path.join(All.opt.dirs.data, 'dumps'),
		keep: 15
	}, opt);
	console.info(`Dumps db
 every ${opt.interval} days
 for ${opt.keep} days
 to ${opt.dir}`);
	var job = new Cron.CronJob({
		cronTime: `0 3 */${opt.interval} * *`,
		onTick: function() {
			doDump(opt.dir, opt.interval * opt.keep * day);
		}
	});
	job.start();
}

function doDump(dir, keep) {
	return fs.mkdir(dir, {
		recursive: true
	}).then(function() {
		exports.dump((new Date).toISOString().split('.')[0].replace(/[-:]/g, '')).then(function() {
			var now = Date.now();
			fs.readdir(dir).then(function(files) {
				return Promise.all(files.map(function(file) {
					file = Path.join(dir, file);
					return fs.stat(file).then(function(stat) {
						if (stat.mtime.getTime() < now - keep - 1000) {
							return fs.unlink(file);
							// TODO dropdb -U ${conn.user} ${conn.database}-${stamp}
						}
					});
				}));
			});
		});
	});
}

