const assert = require('node:assert');
const { site, setupApp } = require('./helpers/common');

suite('apis.get', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	suiteSetup(setupApp);

	test('request block', async function () {
		const { item: page } = await app.run('block.add', {
			type: 'page',
			data: { url: '/test' }
		}, { site: site.id });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-1',
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
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				id: page.id
			}
		}, { site: site.id });
		assert.deepEqual(bget, page);
	});

	test('request block with response', async function () {
		const { item: page } = await app.run('block.add', {
			type: 'page',
			data: { url: '/test' }
		}, { site: site.id });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-2',
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
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				id: page.id
			}
		}, { site: site.id });
		assert.deepEqual(bget, { id: page.id, data: { url: page.data.url } });
	});

	test('request blocks', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 7, height: 8 }
		}, { site: site.id });
		const { item: b2 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 3, height: 2 }
		}, { site: site.id });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-3',
				action: {
					method: 'block.search',
					parameters: {
						type: "layout"
					}
				}
			}
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name
		}, { site: site.id });
		bget.items = bget.items.map(item => item.toJSON());
		assert.deepEqual(bget, {
			count: 2, limit: 10, offset: 0, hrefs: {}, lang: 'fr',
			items: [b1.toJSON(), b2.toJSON()]
		});
	});

	test('request blocks with request', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 7, height: 8, horizontal: 'haround' }
		}, { site: site.id });
		const { item: b2 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 3, height: 2, horizontal: 'haround' }
		}, { site: site.id });

		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-4',
				action: {
					method: 'block.search',
					parameters: {
						type: "layout",
						data: {
							horizontal: 'test'
						}
					},
					request: {
						'data.horizontal': "[$query.h]"
					}
				}
			}
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name,
			query: { h: 'haround' }
		}, { site: site.id });
		assert.deepEqual(bget.items, [b1, b2]);
	});

	test('request blocks with optional request parameter', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 7, height: 8, horizontal: 'haround' }
		}, { site: site.id });
		const { item: b2 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 3, height: 2, horizontal: 'haround' }
		}, { site: site.id });

		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-5',
				action: {
					method: 'block.search',
					parameters: {
						type: "layout",
						id: [b1.id, b2.id]
					},
					request: {
						'data.horizontal': "[$query.h?]"
					}
				}
			}
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name
		}, { site: site.id });
		assert.deepEqual(bget.items, [b1, b2]);
	});

	test('request blocks with response', async function () {
		const { item: b1 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 7, height: 8, horizontal: 'hcenter' }
		}, { site: site.id });
		const { item: b2 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 3, height: 2, horizontal: 'hcenter' }
		}, { site: site.id });

		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-6',
				action: {
					method: 'block.search',
					parameters: {
						type: "layout",
						data: {
							horizontal: 'hcenter'
						}
					},
					response: {
						items: "[items|select:h:data.height:w:data.maxWidth]"
					}
				}
			}
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name
		}, { site: site.id });
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
		}, { site: site.id });
		const { item: b2 } = await app.run('block.add', {
			type: 'layout',
			data: { maxWidth: 3, height: 2, horizontal: 'right' }
		}, { site: site.id });

		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-7',
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
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name
		}, { site: site.id });
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
		}, { site: site.id });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-8',
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
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: "2018-06"
			}
		}, { site: site.id });
		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: "2018-05"
			}
		}, { site: site.id });
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
		}, { site: site.id });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-9',
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
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: "2022-06"
			}
		}, { site: site.id });
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
		}, { site: site.id });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-10',
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
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: ["2021-06-06", "2021-06-08"]
			}
		}, { site: site.id });
		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: ["2021-05-06", "2021-05-08"]
			}
		}, { site: site.id });
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
		}, { site: site.id });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-11',
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
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: "2020-06-08"
			}
		}, { site: site.id });

		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: "2020-05-06"
			}
		}, { site: site.id });
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
		}, { site: site.id });
		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'fetch-12',
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
		}, { site: site.id });

		const bget = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: ["2019-06-08", "2019-06-09"]
			}
		}, { site: site.id });

		assert.deepEqual(eventDate, bget.item);

		const miss = await app.run('apis.get', {
			name: fetch.data.name,
			query: {
				date: ["2019-05-08", "2019-05-09"]
			}
		}, { site: site.id });
		assert(miss.status, 404);
	});
});
