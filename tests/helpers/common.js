const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { randomBytes } = require('node:crypto');
const Path = require('node:path');
const merge = require('lodash.merge');
const Pageboard = require('../../src/pageboard');

const app = new Pageboard();

const bin = Path.join(__dirname, '..', 'bin', 'pageboard');

async function cli(...args) {
	try {
		const { stdout, stderr } = await execFile(bin, args);
		if (stderr) console.error(stderr);
		return JSON.parse(stdout);
	} catch (err) {
		if (err.stderr) throw new Error(err.stderr);
		else throw err;
	}
}

function genId() {
	return randomBytes(12).toString('hex');
}

const site = {
	id: 'test',
	type: 'site',
	data: {
		env: 'dev',
		module: 'pageboard/client#master',
		version: null,
		languages: ['fr', 'en']
	},
	standalone: true,
	content: {}
};

const nullers = {
	expr: null,
	lock: null,
	created_at: null,
	updated_at: null
};

async function setupHelper() {
	await app.init();
	try {
		await app.run('site.del', { id: site.id });
	} catch {
		//ignore
	}
	await app.run('site.add', site);
}

Object.assign(exports, { cli, genId, merge, site, nullers, setupHelper, app });
