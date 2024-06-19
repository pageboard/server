const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { site, app, setupHelper } = require('./helpers/common');

suite('upload', function () {
	this.timeout(require('node:inspector').url() === undefined ? 20000 : 0);

	let dir;

	suiteSetup(async function () {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pageboard-test-'));
		return setupHelper();
	});

	suiteTeardown(async function () {
		await fs.rm(dir, { recursive: true, force: true });
	});

	async function genFile(name, data = 'Some text', encoding = 'utf8') {
		const file = path.join(dir, name);
		await fs.writeFile(file, data, { encoding });
		return file;
	}

	test('upload.add text file', async function () {
		const permission = await app.run('upload.add', {
			path: await genFile('test.txt')
		}, { site: site.id });
		assert.deepEqual(permission, { status: 401, locks: ['user'] });

		const { href } = await app.run('upload.add', {
			path: await genFile('test.txt')
		}, { site: 'test', grant: 'user' });
		assert.ok(href);
		assert.equal(href.mime, 'text/plain');
		assert.equal(href.type, 'link');
		assert.ok(href.url, href.pathname);
		assert.ok(href.url.startsWith('/@file/'));
	});

	test('upload.add image file', async function () {
		const { href } = await app.run('upload.add', {
			path: await genFile('icon.png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64')
		}, { site: site.id, grant: 'user' });
		assert.ok(href);
		assert.equal(href.mime, 'image/png');
		assert.equal(href.type, 'image');
		assert.ok(href.url, href.pathname);
		assert.ok(href.url.startsWith('/@file/'));
		assert.ok(
			href.preview.startsWith('<img src="data:application/octet-stream;base64,')
		);
	});


});
