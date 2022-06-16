const assert = require('node:assert');
const Pageboard = require('..');
const { site } = require('./helpers/common');

const app = new Pageboard();


suite('block', function () {
	this.timeout(10000);

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


	test('add block', async function () {
		const b = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, 'test');
		assert.ok('id' in b, 'has id');
		assert.equal('_id' in JSON.parse(JSON.stringify(b)), false);
	});

	test('add block: validation for missing property', async function () {
		assert.rejects(app.run('block.add', {
			type: 'api_form', data: {}
		}, 'test'), {
			name: 'ValidationError',
			message: "data.action: must have required property 'action'"
		});
	});

	test('save block', async function () {
		const b1 = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, 'test');

		const b2 = await app.run('block.save', {
			id: b1.id,
			type: 'page',
			data: { url: '/test2' }
		}, 'test');
		assert.equal(b2.id, b1.id);
		assert.equal(b2.data.url, '/test2');
	});

	test('delete block', async function () {
		const b1 = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, 'test');

		const b2 = await app.run('block.del', {
			id: b1.id,
			type: 'page'
		}, 'test');

		assert.deepEqual(b2, { count: 1 });

		assert.rejects(app.run('block.get', { id: b1.id }), {
			name: 'BlockNotFound'
		});
	});

});
