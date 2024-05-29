const assert = require('node:assert');
const Pageboard = require('../src/pageboard');
const { site } = require('./helpers/common');

const app = new Pageboard();

suite('apis.get', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	suiteSetup(async function () {
		await app.init();
		try {
			await app.run('site.add', site);
		} catch (err) {
			await app.run('site.empty', { id: site.id });
		}
	});

	test('query block', async function () {
		const { item: page } = await app.run('block.add', {
			type: 'page',
			data: { url: '/test' }
		}, { site: 'test' });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.get',
					parameters: {
						type: "page",
						content: null
					},
					request: {
						id: "[$query.id]"
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id,
			query: {
				id: page.id
			}
		}, { site: 'test' });
		assert.deepEqual(bget, page);
	});

	test('query date by partial date', async function () {
		const { item: eventDate } = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2018-06-07',
					end: '2018-06-10'
				}
			}
		}, { site: 'test' });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date",
						data: {
							slot: {
								start: '2000-01-01'
							}
						}
					},
					request: {
						'data.slot.start': '[$query.date]'
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: "2018-06"
			}
		}, { site: 'test' });
		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: "2018-05"
			}
		}, { site: 'test' });
		assert(miss.status, 404);
	});


	test('query slot by partial date', async function () {
		const { item: eventDate } = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2022-06-07',
					end: '2022-06-10'
				}
			}
		}, { site: 'test' });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date",
						content: null
					},
					request: {
						'data.slot.start': '[$query.date]'
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: "2022-06"
			}
		}, { site: 'test' });
		assert.deepEqual(eventDate, bget.item);
	});

	test('query date by date range', async function () {
		const { item: eventDate } = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2021-06-07',
					end: '2021-06-10'
				}
			}
		}, { site: 'test' });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date",
						content: null
					},
					request: {
						'data.slot.start': "[$query.date]"
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: ["2021-06-06", "2021-06-08"]
			}
		}, { site: 'test' });
		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: ["2021-05-06", "2021-05-08"]
			}
		}, { site: 'test' });
		assert(miss.status, 404);
	});

	test('query date slot by date', async function () {
		const { item: eventDate } = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2020-06-07',
					end: '2020-06-10'
				}
			}
		}, { site: 'test' });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date"
					},
					request: {
						'data.slot': '[$query.date]'
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: "2020-06-08"
			}
		}, { site: 'test' });

		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: "2020-05-06"
			}
		}, { site: 'test' });
		assert(miss.status, 404);
	});

	test('query date slot by date range', async function () {
		const { item: eventDate } = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2019-06-07',
					end: '2019-06-10'
				}
			}
		}, { site: 'test' });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date"
					},
					request: {
						'data.slot': '[$query.date]'
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: ["2019-06-08", "2019-06-09"]
			}
		}, { site: 'test' });

		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('apis.get', {
			id: fetch.id,
			query: {
				date: ["2019-05-08", "2019-05-09"]
			}
		}, { site: 'test' });
		assert(miss.status, 404);
	});
});
