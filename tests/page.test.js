const assert = require('node:assert');
const Pageboard = require('../lib/pageboard');
const { site } = require('./helpers/common');

const app = new Pageboard();

suite('page', function () {
	this.timeout(require('node:inspector').url() === undefined ? 20000 : 0);

	before(async function () {
		await app.init();
		try {
			await app.run('site.add', site);
		} catch (err) {
			// pass
		}
	});
	after(async function () {
		await app.run('archive.empty', null, site.id);
	});

	test('add page', async function () {
		const b = await app.run('page.add', {
			type: 'page', data: { url: '/test/a' }
		}, 'test');
		const c = await app.run('block.get', {
			id: b.id
		}, 'test');
		assert.ok('id' in b, 'has id');
		assert.equal(typeof b.updated_at, "string");
		assert.deepEqual(Object.keys(b), ["id", "updated_at"]);
		assert.equal(c.id, b.id);
		assert.equal(c.type, 'page');
		assert.equal(c.data.url, '/test/a');
	});

	test('get page', async function () {
		const b = await app.run('page.add', {
			type: 'page', data: { url: '/test/a' }
		}, 'test');
		const c = await app.run('page.get', {
			url: '/test/a'
		}, 'test');
		assert.ok('id' in b, 'has id');
		assert.equal(typeof b.updated_at, "string");
		assert.deepEqual(Object.keys(b), ["id", "updated_at"]);
		assert.equal(c.id, b.id);
		assert.equal(c.updated_at, b.udpated_at);
		assert.equal(c.type, 'page');
		assert.equal(c.data.url, '/test/a');
	});


});
