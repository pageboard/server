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

	test('request block', async function () {
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

	test('request block with response', async function () {
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
						id: page.id,
						type: "page",
						content: null
					},
					response: {
						id: "[id]",
						'data.url': "[data.url]"
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
		assert.deepEqual(bget, { id: page.id, data: { url: page.data.url } });
	});

	test('request blocks', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 7, height: 8 }
		}, { site: 'test' });
		const { item: b2 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 3, height: 2 }
		}, { site: 'test' });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.search',
					parameters: {
						type: "layout"
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id
		}, { site: 'test' });
		bget.items = bget.items.map(item => item.toJSON());
		assert.deepEqual(bget, {
			count: 2, limit: 10, offset: 0, hrefs: {},
			items: [b1.toJSON(), b2.toJSON()]
		});
	});

	test('request blocks with response', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 7, height: 8, horizontal: 'haround' }
		}, { site: 'test' });
		const { item: b2 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 3, height: 2, horizontal: 'haround' }
		}, { site: 'test' });

		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.search',
					parameters: {
						type: "layout",
						data: {
							horizontal: 'haround'
						}
					},
					response: {
						items: "[items|select:h:data.height:w:data.maxWidth]"
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id
		}, { site: 'test' });
		assert.deepEqual(bget, {
			items: [{
				w: b1.data.maxWidth, h: b1.data.height
			}, {
				w: b2.data.maxWidth, h: b2.data.height
			}]
		});
	});

	test('request blocks with response as array', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 7, height: 8, horizontal: 'right' }
		}, { site: 'test' });
		const { item: b2 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 3, height: 2, horizontal: 'right' }
		}, { site: 'test' });

		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				action: {
					method: 'block.search',
					parameters: {
						type: "layout",
						data: {
							horizontal: 'right'
						}
					},
					response: {
						w: "[items|at:**|repeat:item|.data.maxWidth]",
						h: "[item.data.height]"
					}
				}
			}
		}, { site: 'test' });

		const bget = await app.run('apis.get', {
			id: fetch.id
		}, { site: 'test' });
		assert.deepEqual(bget, [{
			w: b1.data.maxWidth, h: b1.data.height
		}, {
			w: b2.data.maxWidth, h: b2.data.height
		}]);
	});

	test('request date by partial date', async function () {
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


	test('request slot by partial date', async function () {
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

	test('request date by date range', async function () {
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

	test('request date slot by date', async function () {
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

	test('request date slot by date range', async function () {
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
