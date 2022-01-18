const Path = require('path');
const pify = require('util').promisify;
const exec = pify(require('child_process').execFile);
const schedule = require.lazy("node-schedule");
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
	if (Object.keys(opt.upstreams)[0] == opt.version) scheduleTenantCopy(All);
	// TODO Cron exports.gc...
}

exports.tenant = function (tenant = 'current') {
	const url = All.opt.database.url[tenant];
	if (!url) throw new Error(`No database configured`);
	let tknex;
	if (tenants.has(tenant)) {
		tknex = tenants.get(tenant);
	}	else {
		tknex = knex({
			client: 'pg',
			connection: url,
			debug: Boolean(Log.sql.enabled),
			asyncStackTraces: All.opt.env == "development"
		});
		tenants.set(tenant, tknex);
	}
	return tknex;
};

exports.migrate = function() {
	const opt = All.opt;
	const dirs = opt && opt.migrations || null;
	if (!dirs) throw new Error("Missing `migrations` directory option");
	return Promise.all(dirs.map((dir) => {
		console.info(` ${dir}`);
		return exports.tenant().migrate.latest({
			directory: dir
		}).then(([batchNo, list]) => {
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

function scheduleTenantCopy(All) {
	const { opt } = All;
	const tenants = Object.assign({}, opt.database.url);
	delete tenants.current;
	const slots = Object.keys(tenants);
	if (slots.length == 0) {
		// only current tenant
		return;
	}
	console.info("Scheduling tenant db copies:", slots.join(', '));
	schedule.scheduleJob('0 0 * * *', (date) => {
		const tenant = slots[(date.getDay() - 1) % slots.length];
		return All.run('db.copy', { tenant });
	});
}

exports.copy = function ({ tenant }) {
	const { opt } = All;
	const dir = Path.join(opt.dirs.cache, 'dumps');
	const file = Path.join(dir, `${opt.name}-${tenant}.dump`);
	return fs.mkdir(dir, {
		recursive: true
	}).then(() => {
		return All.run('db.dump', { file });
	}).then(() => {
		return All.run('db.restore', { file, tenant });
	});
};
exports.copy.schema = {
	title: 'Copy current db to tenant db',
	$action: 'write',
	required: ['tenant'],
	properties: {
		tenant: {
			title: 'Tenant',
			type: 'string',
			format: 'id'
		}
	}
};

exports.dump = function ({ file }) {
	const opt = All.opt.database;
	return exec('pg_dump', [
		'--format', 'custom',
		'--table', 'block',
		'--table', 'href',
		'--table', 'relation',
		'--file', file,
		'--dbname', opt.url.current
	]).then(() => {
		return file;
	});
};
exports.dump.schema = {
	$action: 'read',
	required: ['file'],
	properties: {
		file: {
			title: 'File path',
			type: 'string'
		}
	}
};

exports.restore = function ({ file, tenant }) {
	const opt = All.opt.database;
	const url = opt.url[tenant];
	if (!url) {
		throw new HttpError.BadRequest(`Unknown tenant ${tenant}`);
	}
	return exec('pg_restore', ['--dbname', url, '--clean', file]).then(() => {
		return file;
	});
};
exports.restore.schema = {
	title: 'Restore file to tenant db',
	$action: 'write',
	required: ['file', 'tenant'],
	properties: {
		file: {
			title: 'File path',
			type: 'string'
		},
		tenant: {
			title: 'Tenant',
			type: 'string',
			format: 'id'
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
