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

});
