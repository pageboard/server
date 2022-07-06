const assert = require('node:assert');
const Pageboard = require('..');
const { site } = require('./helpers/common');

const app = new Pageboard();

suite('block', function () {
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


	test('add block', async function () {
		const b = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, 'test');
		const c = await app.run('block.get', {
			id: b.id
		}, 'test');
		assert.ok('_id' in b, 'has _id');
		assert.ok('id' in b, 'has id');
		assert.equal(typeof b.updated_at, "string");
		assert.equal('_id' in JSON.parse(JSON.stringify(b)), false);
		assert.deepEqual(b, c);
	});

	test('add block: validation for missing property', async function () {
		assert.rejects(app.run('block.add', {
			type: 'api_form', data: {}
		}, 'test'), {
			name: 'ValidationError',
			message: "data.action: must have required property 'action'"
		});
	});

	test('fill block', async function () {
		const b1 = await app.run('block.add', {
			type: 'page', data: { url: '/testfill' }
		}, 'test');

		const b2 = await app.run('block.fill', {
			id: b1.id,
			contents: [{
				name: 'body',
				children: [
					{
						type: 'heading',
						data: {
							level: 2
						},
						content: {
							text: "Heading2"
						}
					},
					{
						type: 'image',
						data: {
							url: '/.uploads/2022-06/test-200366a3.svg',
							alt: 'mytitle'
						},
						content: {
							legend: "Légende de l'image"
						}
					},
					{
						type: 'paragraph',
						content: 'Test text<br>with <b>some styling</b>'
					}
				]
			}]
		}, 'test');
		assert.equal(b2.id, b1.id);
		assert.equal(b2.children.length, 3);
		assert.equal(b2.content.body, b2.children.map(
			child => `<div block-id="${child.id}"></div>`
		).join(''));

		const b1c = await app.run('block.get', { id: b1.id, children: true }, 'test');
		assert.equal(b1c.children.length, 3);
		assert.deepEqual(b1c.content, b2.content);
	});

	test('clone block', async function () {
		const src = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, 'test');
		await app.run('block.fill', {
			id: src.id,
			contents: [{
				name: 'body',
				children: [{
					id: 'toto',
					type: 'main',
					content: "<p>test</p>"
				}]
			}]
		}, 'test');

		const clone = await app.run('block.clone', {
			id: src.id,
			data: {
				url: '/test2'
			}
		}, 'test');
		const obj = await app.run('block.get', {
			id: clone.id,
			type: 'page',
			children: true
		}, 'test');

		assert.equal(obj.children.length, 1);
		assert.equal(obj.data.url, '/test2');
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

	test('save block with content', async function () {
		const b1 = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, 'test');

		const body = '<main><p>test body</p></main>';
		const b2 = await app.run('block.save', {
			id: b1.id,
			type: 'page',
			content: { body }
		}, 'test');
		assert.equal(b2.id, b1.id);
		assert.equal(b2.content.body, body);
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
