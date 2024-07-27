const assert = require('node:assert');
const { site, nullers, setupApp } = require('./helpers/common');

suite('site', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	suiteSetup(setupApp);

	test('site does not exist', async function () {
		let result, err;
		try {
			await app.run('site.del', { id: site.id });
			result = await app.run('site.get', { id: site.id});
		} catch (e) {
			err = e;
		}
		assert.equal(result, undefined);
		assert.equal(err.name, 'NotFoundError');
	});

	test('add site', async function () {
		try {
			await app.run('site.del', { id: site.id });
		} catch (err) {
			// pass
		}
		const add = await app.run('site.add', site);
		assert.ok(add.updated_at);
		assert.deepEqual({ ...add.toJSON(), ...nullers }, { ...site, ...nullers });
	});

	test('site does exist', async function () {
		try {
			await app.run('site.add', site);
		} catch (err) {
			// pass
		}
		const get = await app.run('site.get', { id: site.id });
		assert.equal(typeof get.updated_at, "string");
		assert.deepEqual({ ...get.toJSON(), ...nullers }, { ...site, ...nullers });
	});

	test('save site', async function () {
		site.data.version = 'HEAD';
		try {
			await app.run('site.add', site);
		} catch (err) {
			// pass
		}
		const save = await app.run('site.save', {
			languages: ['en'], version: null
		}, { site: site.id });
		assert.equal(save.data.version, null);
		assert.ok(save.data.server);
		delete save.data.server;
		assert.equal(typeof save.updated_at, "string");
		site.data.languages = ['en'];
		site.data.version = null;
		assert.deepEqual({ ...save.toJSON(), ...nullers }, { ...site, ...nullers });
	});

	test('delete site', async function () {
		try {
			await app.run('site.add', site);
		} catch (err) {
			// pass
		}
		const del = await app.run('site.del', { id: site.id });
		assert.deepEqual(del, {
			site: 1,
			blocks: 0,
			hrefs: 0
		});
	});

});
