const assert = require('node:assert');
const { site, setupApp } = require('./helpers/common');

suite('page', function () {
	this.timeout(require('node:inspector').url() === undefined ? 20000 : 0);

	suiteSetup(setupApp);

	test('get page', async function () {
		const { item: b } = await app.run('block.add', {
			type: 'page', data: { url: '/test/c' }
		}, { site: site.id });
		assert.ok('id' in b, 'has id');
		assert.equal(typeof b.updated_at, "string");
		const { item, items, hrefs, links, status, parent } = await app.run('page.get', {
			url: '/test/c'
		}, { site: site.id });
		assert.ok(item);
		assert.equal(items.length, 0);
		assert.deepEqual(hrefs, {});
		assert.equal(parent?.type, 'site');
		assert.deepEqual(links, { up: [] });
		assert.equal(status, 200);
		assert.equal(item.id, b.id);
		assert.equal(item.updated_at, b.updated_at);
		assert.equal(item.type, 'page');
		assert.equal(item.data.url, '/test/c');
	});

	test('parse url', async function () {
		assert.deepEqual(await app.run('page.parse', {
			url: '/sub/test'
		}, { site: site.id }), {
			ext: undefined,
			lang: undefined,
			pathname: '/sub/test',
			url: '/sub/test'
		});

		assert.deepEqual(await app.run('page.parse', {
			url: '/sub/test~en'
		}, { site: site.id }), {
			ext: undefined,
			lang: 'en',
			pathname: '/sub/test',
			url: '/sub/test'
		});

		assert.deepEqual(await app.run('page.parse', {
			url: '/sub/test~en-gb'
		}, { site: site.id }), {
			ext: undefined,
			lang: 'en-gb',
			pathname: '/sub/test',
			url: '/sub/test'
		});

		assert.deepEqual(await app.run('page.parse', {
			url: '/sub/test.pdf'
		}, { site: site.id }), {
			ext: 'pdf',
			lang: undefined,
			pathname: '/sub/test',
			url: '/sub/test'
		});

		assert.deepEqual(await app.run('page.parse', {
			url: '/sub/test~pt-br.pdf'
		}, { site: site.id }), {
			ext: 'pdf',
			lang: 'pt-br',
			pathname: '/sub/test',
			url: '/sub/test'
		});
	});

	/*
	test('page match', async function () {
		// TODO
		await app.run('block.add', {
			type: 'page', data: { url: '/root/special' }
		}, { site: site.id });

		await app.run('block.add', {
			type: 'page', data: { url: '/root/', prefix: true }
		}, { site: site.id });

		await assert.rejects(() => app.run('block.add', {
			type: 'page', data: { url: '/other', prefix: true }
		}, { site: site.id }));

		const gen = await app.run('page.get', {
			url: '/root/generic'
		}, { site: site.id });
		assert.equal(gen.status, 200);
		assert.equal(gen.item.data.prefix, true);
		assert.equal(gen.item.data.url, '/root/');

		const spe = await app.run('page.get', {
			url: '/root/special'
		}, { site: site.id });
		assert.equal(spe.status, 200);
		assert.equal(spe.item.data.url, '/root/special');
		assert.equal(spe.item.data.prefix, null);

	});
	*/


});
