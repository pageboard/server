const assert = require('node:assert');

const Pageboard = require('..');
const { merge, site } = require('./helpers/common');

const app = new Pageboard();

suite('site', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	before(async function () {
		await app.init();
	});

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
		assert.deepEqual(add.toJSON(), site);
	});

	test('site does exist', async function () {
		try {
			await app.run('site.add', site);
		} catch (err) {
			// pass
		}
		const get = await app.run('site.get', { id: site.id });
		assert.ok(get.updated_at instanceof Date);
		delete get.updated_at;
		const nsite = merge({}, site, {
			content: {},
			expr: null,
			lock: null
		});
		assert.deepEqual(get.toJSON(), nsite);
	});

	test('save site', async function () {
		try {
			await app.run('site.add', site);
		} catch (err) {
			// pass
		}
		const save = await app.run('site.save', {
			id: site.id,
			data: { lang: 'en' }
		});
		assert.ok(save.data.server);
		delete save.data.server;
		assert.ok(save.updated_at);
		delete save.updated_at;
		const nsite = merge({}, site, {
			content: {},
			expr: null,
			lock: null,
			data: {
				lang: 'en'
			}
		});
		assert.deepEqual(save.toJSON(), nsite);
	});

	test('delete site', async function () {
		try {
			await app.run('site.add', site);
		} catch (err) {
			// pass
		}
		const del = await app.run('site.del', { id: site.id });
		assert.deepEqual(del, {
			blocks: 1
		});
	});

});
