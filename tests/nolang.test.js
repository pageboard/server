const assert = require('node:assert');
const Pageboard = require('../src/pageboard');
const { site } = require('./helpers/common');

const app = new Pageboard();

suite('content without lang', function () {
	this.timeout(require('node:inspector').url() === undefined ? 20000 : 0);

	suiteSetup(async function () {
		await app.init();
		delete site.data.languages;
		try {
			await app.run('site.add', site);
		} catch (err) {
			await app.run('site.empty', { id: site.id });
		}
	});

	test('fill block', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'page', data: { url: '/testfill' }
		}, { site: 'test' });

		const { item: b2 } = await app.run('block.fill', {
			id: b1.id,
			type: ['heading', 'image', 'paragraph'],
			name: 'body',
			items: [{
				type: 'heading',
				data: {
					level: 2
				},
				content: {
					text: "Heading2"
				}
			}, {
				type: 'image',
				data: {
					url: '/_data/2022-06/test-200366a3.svg',
					alt: 'mytitle'
				},
				content: {
					legend: "Légende de l'image"
				}
			}, {
				type: 'paragraph',
				content: 'Test text<br>with <b>some styling</b>'
			}]
		}, { site: 'test' });
		assert.equal(b2.id, b1.id);
		assert.equal(b2.children.length, 3);
		assert.equal(b2.content.body, b2.children.map(
			child => `<div block-id="${child.id}"></div>`
		).join(''));

		const b1c = await app.run('block.get', {
			id: b1.id, children: true, content: null
		}, { site: 'test' });
		assert.equal(b1c.children.length, 3);
		assert.deepEqual(b1c.content, b2.content);
	});

	test('save block with content', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, { site: 'test' });

		const body = '<main><p>test body</p></main>';
		const { item: b2 } = await app.run('block.save', {
			id: b1.id,
			type: 'page',
			content: { body }
		}, { site: 'test' });
		assert.equal(b2.id, b1.id);
		assert.equal(b2.content.body, body);
	});

});
