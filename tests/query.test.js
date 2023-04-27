const assert = require('node:assert');
const Pageboard = require('../src/pageboard');
const { site } = require('./helpers/common');

const app = new Pageboard();

suite('query', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	before(async function () {
		await app.init();
		try {
			await app.run('site.add', site);
		} catch (err) {
			await app.run('site.empty', { id: site.id });
		}
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

	test('query date by partial date', async function () {
		const eventDate = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2018-06-07',
					end: '2018-06-10'
				}
			}
		}, 'test');
		const fetch = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date"
					}
				}
			},
			expr: {
				action: {
					parameters: {
						data: {
							slot: {
								start: "[$query.date]"
							}
						}
					}
				}
			}
		}, 'test');

		const bget = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: "2018-06"
			}
		}, 'test');
		delete eventDate.content;
		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: "2018-05"
			}
		}, 'test');
		assert(miss.status, 404);
	});


	test('query slot by partial date', async function () {
		const eventDate = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2022-06-07',
					end: '2022-06-10'
				}
			}
		}, 'test');
		const fetch = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date"
					}
				}
			},
			expr: {
				action: {
					parameters: {
						data: {
							slot: {
								start: "[$query.date]"
							}
						}
					}
				}
			}
		}, 'test');

		const bget = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: "2022-06"
			}
		}, 'test');
		delete eventDate.content;
		assert.deepEqual(eventDate, bget.item);
	});

	test('query date by date range', async function () {
		const eventDate = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2021-06-07',
					end: '2021-06-10'
				}
			}
		}, 'test');
		const fetch = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date"
					}
				}
			},
			expr: {
				action: {
					parameters: {
						data: {
							slot: {
								start: "[$query.date]"
							}
						}
					}
				}
			}
		}, 'test');

		const bget = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: ["2021-06-06", "2021-06-08"]
			}
		}, 'test');
		delete eventDate.content;
		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: ["2021-05-06", "2021-05-08"]
			}
		}, 'test');
		assert(miss.status, 404);
	});

	test('query date slot by date', async function () {
		const eventDate = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2020-06-07',
					end: '2020-06-10'
				}
			}
		}, 'test');
		const fetch = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date"
					}
				}
			},
			expr: {
				action: {
					parameters: {
						data: {
							slot: "[$query.date]"
						}
					}
				}
			}
		}, 'test');

		const bget = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: "2020-06-08"
			}
		}, 'test');
		delete eventDate.content;
		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: "2020-05-06"
			}
		}, 'test');
		assert(miss.status, 404);
	});

	test('query date slot by date range', async function () {
		const eventDate = await app.run('block.add', {
			type: 'event_date',
			data: {
				slot: {
					start: '2019-06-07',
					end: '2019-06-10'
				}
			}
		}, 'test');
		const fetch = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.find',
					parameters: {
						type: "event_date"
					}
				}
			},
			expr: {
				action: {
					parameters: {
						data: {
							slot: "[$query.date]"
						}
					}
				}
			}
		}, 'test');

		const bget = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: ["2019-06-08", "2019-06-09"]
			}
		}, 'test');
		delete eventDate.content;
		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('search.query', {
			id: fetch.id,
			query: {
				date: ["2019-05-08", "2019-05-09"]
			}
		}, 'test');
		assert(miss.status, 404);
	});
});
