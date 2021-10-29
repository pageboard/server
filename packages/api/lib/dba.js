var Path = require('path');
var pify = require('util').promisify;
var exec = pify(require('child_process').exec);
var schedule = require('node-schedule');

exports.migrate = function(knex, dirs) {
	return Promise.all(dirs.map(function(dir) {
		console.info(` ${dir}`);
		return knex.migrate.latest({
			directory: dir
		}).spread(function(batchNo, list) {
			if (list.length) return list;
			return "No migrations run in this directory";
		});
	}));
};

exports.seed = function(knex, dirs) {
	return Promise.all(dirs.map(function(dir) {
		console.info(` ${dir}`);
		return knex.seed.run({
			directory: dir
		}).spread(function(list) {
			if (list.length) console.log(" ", list.join("\n "));
			else console.log("No seed files in", dir);
		});
	}));
};

exports.dump = function(conn, opt) {
	var dumpDir = opt.database.dump && opt.database.dump.dir;
	if (!dumpDir) throw new HttpError.BadRequest("Missing database.dump.dir config");
	var stamp = (new Date).toISOString().split('.')[0].replace(/[-:]/g, '');
	var file = Path.join(dumpDir, `${opt.name}-${stamp}.dump`);
	return exec(`pg_dump --format=custom --file=${file} --username=${conn.user} ${conn.database}`, {}).then(function() {
		return file;
	});
};

exports.knexConfig = function(config) {
	const opt = All.opt.database;
	const url = opt.url.current;
	return {
		client: 'pg',
		connection: url,
		asyncStackTraces: config.env == "development"
	};
};

var gcJob;
exports.gc = function(All) {
/*
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
*/
};
