const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { site, setupServer, teardownServer, shortImg } = require('./helpers/common');

suite('upload', function () {
	this.timeout(require('node:inspector').url() === undefined ? 20000 : 0);

	let dir;

	suiteSetup(async function () {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pageboard-test-'));
		return setupServer();
	});

	suiteTeardown(async function () {
		await fs.rm(dir, { recursive: true, force: true });
		await teardownServer();
	});

	test('upload.files using apis.post', async function () {
		await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'uploadfiles',
				action: {
					method: 'upload.files',
					parameters: {
						size: 200,
						types: ['image/*']
					},
					request: {
						files: '[$request.files]'
					}
				}
			}
		}, { site: site.id });
		const grant = 'user';
		const email = 'test@example.com';
		const { item: settings } = await app.run('settings.grant', {
			email, grant
		}, { site: site.id, grant: 'root' });
		const bearer = await app.run('auth.bearer', {
			id: settings.parent.id,
			grants: [grant],
		}, { site: site.id, grant: 'root' });

		const body = new FormData();
		body.set("files", new Blob([shortImg]), "icon2.png");
		const appUrl = `http://${site.id}.localhost.localdomain:${app.opts.server.port}`;
		const res = await fetch(new URL('/@api/uploadfiles', appUrl), {
			redirect: 'error',
			headers: {
				'Cookie': 'bearer=' + bearer.value,
				'X-Forwarded-By': '127.0.0.1'
			},
			method: 'POST',
			body
		});
		assert.equal(res.status, 200);
		const { hrefs } = await res.json();
		const [href] = hrefs;
		assert.equal(href.type, 'image');
	});

	test('upload form data to apis.post', async function () {
		await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'addtest',
				action: {
					method: 'block.add',
					parameters: {
						type: "image"
					},
					request: {
						'data.url': '[$request.src]',
						'content.alt': '[$request.alt]'
					}
				}
			}
		}, { site: site.id });
		const grant = 'user';
		const email = 'test@example.com';
		const { item: settings } = await app.run('settings.grant', {
			email, grant
		}, { site: site.id, grant: 'root' });
		const bearer = await app.run('auth.bearer', {
			id: settings.parent.id,
			grants: [grant],
		}, { site: site.id, grant: 'root' });

		const body = new FormData();
		body.set("src", new Blob([shortImg]), "icon2.png");
		body.set("alt", "test alt");
		const appUrl = `http://${site.id}.localhost.localdomain:${app.opts.server.port}`;
		const res = await fetch(new URL('/@api/addtest', appUrl), {
			redirect: 'error',
			headers: {
				'Cookie': 'bearer=' + bearer.value,
				'X-Forwarded-By': '127.0.0.1'
			},
			method: 'POST',
			body
		});
		assert.equal(res.status, 200);
		const { item } = await res.json();
		assert.equal(item.type, 'image');
		assert.equal(item.content.alt, 'test alt');
		assert.ok(item.data.url);
	});

	test('upload form data and fail with wrong mime type', async function () {
		await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'addfailtest',
				action: {
					method: 'block.add',
					parameters: {
						type: "image"
					},
					request: {
						'data.url': '[$request.src]',
						'data.alt': '[$request.alt]'
					}
				}
			}
		}, { site: site.id });
		const grant = 'user';
		const email = 'test@example.com';
		const { item: settings } = await app.run('settings.grant', {
			email, grant
		}, { site: site.id, grant: 'root' });
		const bearer = await app.run('auth.bearer', {
			id: settings.parent.id,
			grants: [grant],
		}, { site: site.id, grant: 'root' });

		const body = new FormData();
		body.set("src", new Blob([Buffer.from("console.log('toto');")]), "test.bin");
		body.set("alt", "test alt");
		const appUrl = `http://${site.id}.localhost.localdomain:${app.opts.server.port}`;
		const res = await fetch(new URL('/@api/addfailtest', appUrl), {
			redirect: 'error',
			headers: {
				'Cookie': 'bearer=' + bearer.value,
				'X-Forwarded-By': '127.0.0.1'
			},
			method: 'POST',
			body
		});
		assert.equal(res.status, 400);
		const obj = await res.json();
		assert.equal(obj.status, 400);
		assert.equal(obj.item.type, 'error');
		assert.equal(obj.item.data['data.url'][0].keyword, '$file');
	});

	/*
	test('upload a fake href', async function () {
		const filePath = '/@file/2019-01/test.txt';
		global.AllHrefs.set(filePath, {
			mime: 'text/plain', size: 100, type: 'link',
			url: filePath,
			pathname: filePath
		});
		try {
			await app.run('upload.files', {
				files: [filePath]
			}, { site: site.id });
		} catch (err) {
			assert.equal(err.status, 401);
		}

		const hrefs = await app.run('upload.files', {
			files: [filePath]
		}, { site: 'test', grant: 'user' });
		assert.ok(hrefs);
		assert.equal(hrefs.length, 1);
		const href = hrefs[0];
		assert.equal(href.mime, 'text/plain');
		assert.equal(href.type, 'link');
		assert.ok(href.url, href.pathname);
		assert.ok(href.url.startsWith('/@file/'));
	});
	*/
});
