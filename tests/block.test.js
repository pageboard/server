const assert = require('node:assert');
const { site, setupApp } = require('./helpers/common');

suite('block', function () {
	this.timeout(require('node:inspector').url() === undefined ? 20000 : 0);

	suiteSetup(setupApp);

	test('add block', async function () {
		const { item: b } = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, { site: site.id });
		const c = await app.run('block.get', {
			id: b.id
		}, { site: site.id });
		assert.ok('_id' in b, 'has _id');
		assert.ok('id' in b, 'has id');
		assert.equal(typeof b.updated_at, "string");
		assert.equal('_id' in JSON.parse(JSON.stringify(b)), false);
		assert.deepEqual(b, c);
	});

	test('add block: validation for missing property', async function () {
		assert.rejects(app.run('block.add', {
			type: 'api_form', data: {}
		}, { site: site.id }), {
			name: 'ValidationError',
			message: "data.action: must have required property 'action'"
		});
	});

	test('add block: coerce date time', async function () {
		const { item } = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2018-06-07',
					end: '2018-06-10'
				}
			}
		}, { site: site.id });

		assert.equal(
			item.data.slot.start.split('.')[0],
			'2018-06-07T00:00:00.000Z'.split('.')[0]
		);

		const { item: block } = await app.run('block.find', {
			id: item.id, type: item.type
		}, { site: site.id });

		assert.equal(
			block.data.slot.start.split('.')[0],
			'2018-06-07T00:00:00.000Z'.split('.')[0]
		);
	});

	test('add block: coerce wrong date time', async function () {
		const { item: eventDate } = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: 'aa2018-06-07'
				}
			}
		}, { site: site.id });
		assert.equal(eventDate.data.slot.start, null);
	});

	test('add block to parent', async function () {
		const { item: event } = await app.run('block.add', {
			type: 'event',
			data: { title: 'event title' }
		}, { site: site.id });
		const { item: eventDate } = await app.run('block.add', {
			type: 'event_date',
			data: {},
			parents: [{
				id: event.id,
				type: 'event'
			}]
		}, { site: site.id });
		const { item } = await app.run('block.find', {
			type: "event_date",
			parent: {
				type: 'event',
				id: event.id
			}
		}, { site: site.id });
		assert.equal(item.id, eventDate.id);
	});

	test('unicity of field with block.add', async function () {
		await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'form45',
				action: {
					method: 'redirect.post'
				}
			}
		}, { site: site.id });

		await assert.rejects(() => app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'form45',
				action: {
					method: 'redirect.post'
				}
			}
		}, { site: site.id }));
	});

	test('search blocks and order by field', async function () {
		const type = 'event';
		await app.run('block.add', {
			type, data: { title: 'A' }
		}, { site: site.id });
		await app.run('block.add', {
			type, data: { title: 'B' }
		}, { site: site.id });
		await app.run('block.add', {
			type, data: { title: 'C' }
		}, { site: site.id });
		await app.run('block.add', {
			type, data: { title: 'D' }
		}, { site: site.id });
		const titles = ['D', 'A', 'C', 'B'];
		const { items } = await app.run('block.search', {
			type,
			data: {
				title: titles
			},
			order: ['data.title']
		}, { site: site.id });
		const list = items.map(item => item.data.title);
		assert.deepEqual(list, titles);
	});

	test('fill block', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'page', data: { url: '/testfill' }
		}, { site: site.id });

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
		}, { site: site.id });
		assert.equal(b2.id, b1.id);
		assert.equal(b2.children.length, 3);
		assert.equal(b2.content.body, b2.children.map(
			child => `<div block-id="${child.id}"></div>`
		).join(''));

		const b1c = await app.run('block.get', {
			id: b1.id, children: true, content: null
		}, { site: site.id });
		assert.equal(b1c.children.length, 3);
		assert.deepEqual(b1c.content, b2.content);
	});

	test('clone block', async function () {
		const { item: src } = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, { site: site.id });
		await app.run('block.fill', {
			id: src.id,
			name: 'body',
			type: [],
			items: [{
				id: 'toto',
				type: 'main',
				content: "<p>test</p>"
			}]
		}, { site: site.id });

		const clone = await app.run('block.clone', {
			id: src.id,
			data: {
				url: '/test2'
			}
		}, { site: site.id });
		const obj = await app.run('block.get', {
			id: clone.id,
			type: 'page',
			children: true
		}, { site: site.id });

		assert.equal(obj.children.length, 1);
		assert.equal(obj.data.url, '/test2');
	});

	test('save block', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'page', data: { url: '/test', index: 2 }
		}, { site: site.id });

		const { item: b2 } = await app.run('block.save', {
			id: b1.id,
			type: 'page',
			data: { url: '/test2', index: null }
		}, { site: site.id });
		assert.equal(b2.id, b1.id);
		assert.equal(b2.data.url, '/test2');
		assert.equal(b2.data.index, 0);
	});

	test('save block with content', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, { site: site.id });

		const body = '<main><p>test body</p></main>';
		const { item: b2 } = await app.run('block.save', {
			id: b1.id,
			type: 'page',
			content: { body }
		}, { site: site.id });
		assert.equal(b2.id, b1.id);
		assert.equal(b2.content.body, body);
	});

	test('save block with content with empty id', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'language',
			data: { lang: 'xx' },
			content: { '': 'title' }
		}, { site: site.id });
		const { item: b2 } = await app.run('block.save', {
			id: b1.id,
			type: 'language',
			content: { '': 'title' }
		}, { site: site.id });
		const { item } = await app.run('block.find', {
			type: "language",
			id: b1.id
		}, { site: site.id });
		assert.deepEqual(item.content, b2.content);
	});

	test('delete block', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'page', data: { url: '/test' }
		}, { site: site.id });

		const b2 = await app.run('block.del', {
			id: b1.id,
			type: 'page'
		}, { site: site.id });

		assert.deepEqual(b2, { count: 1 });

		assert.rejects(app.run('block.get', { id: b1.id }), {
			name: 'BlockNotFound'
		});
	});

	test('find block by integer comparison of different columns', async function () {
		const { item: block } = await app.run('block.add', {
			type: 'input_number',
			data: {
				name: 'blurg',
				min: 11,
				max: 15
			}
		}, { site: site.id });
		const { item } = await app.run('block.find', {
			type: "input_number",
			data: {
				'max#lte': '16',
				'min#gte': '2'
			}
		}, { site: site.id });

		assert.deepEqual(block, item);
	});

	test('find block by integer comparison of same column', async function () {
		const { item: page } = await app.run('block.add', {
			type: 'page',
			data: {
				url: '/testindex',
				index: 12
			}
		}, { site: site.id });
		const { item } = await app.run('block.find', {
			type: "page",
			data: {
				'index#lte': '16',
				'index#gte': '2'

			}
		}, { site: site.id });

		assert.deepEqual(page, item);
	});

});
