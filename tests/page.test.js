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
		assert.ok('id' in b, 'has id');
		assert.equal(typeof b.updated_at, "string");
		assert.deepEqual(Object.keys(b), ["id", "updated_at"]);
		const result = await app.run('page.get', {
			url: '/test/a'
		}, 'test');
		const { item, links, status, site, meta } = result;
		assert.ok(item);
		assert.ok(site);
		assert.ok(meta);
		assert.equal(meta.name, 'page');
		assert.equal(status, 200);
		assert.deepEqual(links, { up: [] });
		assert.equal(item.id, b.id);
		assert.equal(item.updated_at, b.updated_at);
		assert.equal(item.type, 'page');
		assert.equal(item.data.url, '/test/a');
	});

	test('page match', async function () {
		await app.run('page.add', {
			type: 'page', data: { url: '/test/special' }
		}, 'test');

		await app.run('page.add', {
			type: 'page', data: { url: '/test', match: true }
		}, 'test');

		const gen = await app.run('page.get', {
			url: '/test/generic'
		}, 'test');
		assert.equal(gen.status, 200);
		assert.equal(gen.item.data.match, true);
		assert.equal(gen.item.data.url, '/test');

		const spe = await app.run('page.get', {
			url: '/test/special'
		}, 'test');
		assert.equal(spe.status, 200);
		assert.equal(spe.item.data.match, false);
		assert.equal(spe.item.data.url, '/test/special');

	});


});