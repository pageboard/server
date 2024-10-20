const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { randomBytes } = require('node:crypto');
const Path = require('node:path');
const Pageboard = require('../../src/pageboard');

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
		dependencies: {
			'@pageboard/site': 'link://./tests/fixtures/client/packages/site'
		},
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

async function setup(start) {
	const app = new Pageboard({ cli: !start });
	await app.init();
	try {
		await app.run('site.del', { id: site.id });
	} catch {
		//ignore
	}
	await app.run('site.add', site);
	global.app = app;
}

async function setupApp() {
	return setup(false);
}

async function setupServer() {
	return setup(true);
}

async function teardownServer() {
	await global?.app.stop();
}

const shortImg = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
	'base64'
);

Object.assign(exports, {
	cli,
	genId,
	site,
	nullers,
	setupApp,
	setupServer,
	teardownServer,
	shortImg
});
