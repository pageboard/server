const assert = require('node:assert');
const Pageboard = require('../lib/pageboard');
const { site } = require('./helpers/common');

const app = new Pageboard();

suite('query', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

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


	test('query block', async function () {
		const page = await app.run('block.add', {
			type: 'page',
			data: { url: '/test' }
		}, 'test');
		const fetch = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.get',
					parameters: {
						type: "page"
					}
				}
			},
			expr: {
				action: {
					parameters: {
						id: "[$query.id]"
					}
				}
			}
		}, 'test');

		const bget = await app.run('search.query', {
			id: fetch.id,
			query: {
				id: page.id
			}
		}, 'test');
		assert.deepEqual(bget, page);
	});

});
