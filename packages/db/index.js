const Path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const schedule = require("node-schedule");
const knex = require('knex');
const pg = require('pg');

const tenants = new Map();

module.exports = class DatabaseModule {
	static name = 'database';
	static $global = true;
	static priority = -100;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		if (!opts.dumps) opts.dumps = Path.join(app.dirs.cache, 'dumps');
		app.dirs.dumps = opts.dumps;
		pg.types.setTypeParser(
			pg.types.builtins.TIMESTAMPTZ,
			str => str.split(' ').join('T') + ":00"
		);
		pg.types.setTypeParser(
			pg.types.builtins.INT8,
			str => {
				// convert BigInt to Number, or keep it as a String
				// count() is a int8 so this is made to avoid having count to be a string
				const n = Number(str);
				if (n.toString() != n) return str;
				else return n;
			}
		);
		// 1016 (array of int8) is less useful
	}
	apiRoutes(router) {
		if (this.app.version == this.app.upstream) {
			this.#scheduleTenantCopy();
		}
	}
	tenant(tenant) {
		if (!tenant) tenant = this.opts.tenant;
		const url = this.opts.url[tenant];
		if (!url) throw new Error(`No database configured`);
		let tknex;
		if (tenants.has(tenant)) {
			tknex = tenants.get(tenant);
		}	else {
			tknex = knex({
				client: 'pg',
				connection: url,
				debug: Boolean(Log.sql.enabled)
			});
			tenants.set(tenant, tknex);
		}
		return tknex;
	}

	async migrate() {
		const [, list] = await this.tenant().migrate.latest({
			directory: Path.join(__dirname, 'migrations')
		});
		if (list.length) return list;
		return "No migrations";
	}

	#scheduleTenantCopy() {
		const tenants = { ...this.opts.url };
		delete tenants.current;
		const slots = Object.keys(tenants);
		if (slots.length == 0) {
			// only current tenant
			return;
		}
		console.info("Scheduling tenant db copies:", slots.join(', '));
		schedule.scheduleJob('0 0 * * *', (date) => {
			const tenant = slots[(date.getDay() - 1) % slots.length];
			return this.app.run('database.copy', { tenant });
		});
	}

	async setup(req, { tenant, file }) {
		const url = this.opts.url[tenant];
		if (!url) {
			throw new HttpError.BadRequest(`Unknown tenant ${tenant}`);
		}
		await exec('psql', [
			'--dbname', url,
			'--file',
			file
		]);
		return file;
	}
	static setup = {
		title: 'Setup tenant',
		$private: true,
		$action: 'write',
		required: ['file', 'tenant'],
		properties: {
			file: {
				title: 'File path',
				type: 'string',
				default: Path.join(__dirname, 'sql/schema.sql')
			},
			tenant: {
				title: 'Tenant',
				type: 'string',
				format: 'id'
			}
		}
	};

	async copy(req, { tenant }) {
		const file = Path.join(this.opts.dumps, `${this.app.name}-${tenant}.dump`);
		await req.run('database.dump', { file });
		await req.run('database.restore', { file, tenant });
	}
	static copy = {
		title: 'Copy to tenant',
		$action: 'write',
		$private: true,
		required: ['tenant'],
		properties: {
			tenant: {
				title: 'Tenant',
				type: 'string',
				format: 'id'
			}
		}
	};

	async dump(req, { file, schema, format }) {
		const args = [
			'--format', format,
			'--clean',
			'--if-exists',
			'--no-owner',
			'--no-comments',
			'--no-tablespaces',
			'--schema', 'public',
			'--file', file,
			'--dbname', this.opts.url.current
		];
		if (schema) args.unshift('--schema-only');
		await exec('pg_dump', args);
		return file;
	}
	static dump = {
		title: 'Dump',
		$action: 'read',
		required: ['file'],
		$private: true,
		properties: {
			file: {
				title: 'File path',
				type: 'string'
			},
			schema: {
				title: 'Only schema',
				type: 'boolean',
				default: false
			},
			format: {
				title: 'File format',
				default: 'custom',
				anyOf: [{
					const: 'custom'
				}, {
					const: 'plain'
				}]
			}
		}
	};

	async restore(req, { file, tenant }) {
		const url = this.opts.url[tenant];
		if (!url) {
			throw new HttpError.BadRequest(`Unknown tenant ${tenant}`);
		}
		await exec('pg_restore', [
			'--dbname', url,
			'--clean',
			'--if-exists',
			'--no-owner',
			'--no-comments',
			'--schema', 'public',
			file
		]);
		return file;
	}
	static restore = {
		title: 'Restore to tenant',
		$action: 'write',
		$private: true,
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
		All.site.gc(blockDays),
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
