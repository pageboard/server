const Path = require('path');
const pify = require('util').promisify;
const exec = pify(require('child_process').exec);
const Cron = require.lazy("cron");
const fs = require('fs').promises;
const knex = require('knex');

const tenants = new Map();

exports = module.exports = function() {
	return {
		name: 'db',
		priority: -100,
		service: init
	};
};

function init(All) {
	const opt = All.opt;
	if (Object.keys(opt.upstreams)[0] == opt.version) initDumps(All);
	// TODO Cron exports.gc...
}

exports.tenant = function (site) {
	const opt = All.opt.database;
	const key = 'current';
	const url = opt.url[key];
	if (!url) throw new Error(`No database configured for '${key}'`);
	let t;
	if (tenants.has(key)) {
		t = tenants.get(key);
	}	else {
		t = knex({
			client: 'pg',
			connection: url,
			debug: Boolean(Log.sql.enabled),
			asyncStackTraces: All.opt.env == "development"
		});
		tenants.set(key, t);
	}
	return t;
};

exports.migrate = function() {
	const opt = All.opt;
	const dirs = opt && opt.migrations || null;
	if (!dirs) throw new Error("Missing `migrations` directory option");
	return Promise.all(dirs.map((dir) => {
		console.info(` ${dir}`);
		return exports.knex.migrate.latest({
			directory: dir
		}).spread((batchNo, list) => {
			if (list.length) return list;
			return "No migrations run in this directory";
		});
	}));
};
exports.migrate.schema = {
	$action: 'write'
};

exports.seed = function() {
	const opt = All.opt;
	const dirs = opt && opt.seeds || null;
	if (!dirs) throw new Error("Missing `seeds` directory option");
	return Promise.all(dirs.map((dir) => {
		console.info(` ${dir}`);
		return exports.knex.seed.run({
			directory: dir
		}).spread((list) => {
			if (list.length) console.info(" ", list.join("\n "));
			else console.info("No seed files in", dir);
		});
	}));
};

exports.dump = function ({ trx }, { name }) {
	const appName = All.opt.name;
	const opt = All.opt.database;
	const dumpDir = opt.dump && opt.dump.dir;
	if (!dumpDir) throw new HttpError.BadRequest("Missing database.dump.dir config");
	const file = Path.join(Path.resolve(All.opt.dir, dumpDir), `${appName}-${name}.dump`);
	return exec(`pg_dump --format=custom --file=${file} ${opt.url.current}`, {}).then(() => {
		return file;
	});
};
exports.dump.schema = {
	$action: 'read',
	required: ['name'],
	properties: {
		name: {
			title: 'Name',
			type: 'string',
			pattern: '^\\w+$'
		}
	}
};

exports.restore = function({trx}, {name}) {
	const opt = All.opt.database;
	const dumpDir = opt.dump && opt.dump.dir;
	if (!dumpDir) throw new HttpError.BadRequest("Missing database.dump.dir config");
	const db = `${opt.name}-${name}`;
	const file = Path.join(Path.resolve(All.opt.dir, dumpDir), `${db}.dump`);
	return exec(`createdb -U ${opt.user} -T template1 ${db}`, {}).then(() => {
		return exec(`pg_restore -d ${db} -U ${opt.user} ${file}`, {}).then(() => {
			return file;
		});
	}).catch((err) => {
		return exec(`dropdb -U ${opt.user} ${db}`, {});
	});
};
exports.restore.schema = {
	$action: 'write',
	required: ['name'],
	properties: {
		name: {
			title: 'Name',
			type: 'string',
			pattern: '^\\w+$'
		}
	}
};

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
	let opt = All.opt.database.dump;
	if (!opt) return;
	const day = 1000 * 60 * 60 * 24;
	opt = All.opt.database.dump = Object.assign({
		interval: 1,
		dir: Path.join(All.opt.dirs.data, 'dumps'),
		keep: 15
	}, opt);
	const job = new Cron.CronJob({
		cronTime: `0 3 */${opt.interval} * *`,
		onTick: function() {
			const dir = Path.resolve(All.opt.dir, opt.dir);
			doDump(dir, opt.interval * opt.keep * day).then(() => {
				console.info("cron: db.dump to", dir);
			}).catch((err) => {
				console.error("cron: db.dump to", dir, err);
			});
		},
	});
	job.start();
}

function doDump(dir, keep) {
	return fs.mkdir(dir, {
		recursive: true
	}).then(() => {
		return All.run('db.dump', {trx: false}, {
			name: (new Date()).toISOString().split('.')[0].replaceAll(/[-:]/g, '')
		}).then(() => {
			const now = Date.now();
			fs.readdir(dir).then((files) => {
				return Promise.all(files.map((file) => {
					file = Path.join(dir, file);
					return fs.stat(file).then((stat) => {
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

