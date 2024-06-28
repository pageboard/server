const assert = require('node:assert');
const { site, setupApp } = require('./helpers/common');

suite('apis.post', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	suiteSetup(setupApp);

	test('Verify token', async function () {
		const email = 'test@test.localhost.localdomain';
		const grant = 'webmaster';

		await app.run('settings.grant', {
			email, grant
		}, { site: site.id, grant: 'root' });

		const token = new URLSearchParams((await app.run('login.link', {
			email, grant
		}, { site: site.id, grant: 'root' })).split('?').pop()).get('token');

		const { item: form } = await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'form1',
				action: {
					method: 'login.verify',
					parameters: {
						grant
					},
					request: {
						token: "[$request.token]",
						email: "[$request.email]"
					},
					response: {
						bearer: '[cookies.bearer.value]'
					}
				}
			}
		}, { site: site.id });

		const bpost = await app.run('apis.post', {
			name: form.data.name,
			body: {
				token,
				email
			}
		}, { site: site.id });
		assert.deepEqual(Object.keys(bpost), ['bearer']);
		assert.ok(bpost.bearer);
	});

	test('Repeat method can be used to redirect to a parametrized api', async function () {
		const { item: page } = await app.run('block.add', {
			type: 'page',
			data: { url: '/testpage' }
		}, { site: site.id });

		const { item: form } = await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'myform',
				action: {
					method: 'redirect.post',
					request: {
						id: '[$request.id]'
					}
				},
				redirection: {
					name: 'select1',
					parameters: {
						id: '[$response.id]'
						// TODO rename parameters to query here
						// action.response could be used directly
						// instead of having another layer of variables
						// however, when redirecting externally,
						// this is necessary
						// so it is always good practice to separate
						// redirection.query from action.response
					}
				}
			}
		}, { site: site.id });

		const { item: fetch } = await app.run('block.add', {
			type: 'fetch',
			data: {
				name: 'select1',
				action: {
					method: 'block.find',
					parameters: {
						type: "page"
					},
					request: {
						id: '[$query.id]'
					},
					response: {
						url: '[item.data.url]'
					}
				}
			}
		}, { site: site.id });

		const bpost = await app.run('apis.post', {
			name: form.data.name,
			body: {
				id: page.id
			}
		}, { site: site.id });
		assert.equal(bpost.url, '/testpage');
	});

	test('Chaing two api forms one after another', async function () {
		const { item: page } = await app.run('block.add', {
			type: 'page',
			data: { url: '/test' }
		}, { site: site.id });

		const { item: page2 } = await app.run('block.add', {
			type: 'page',
			data: { url: '/test2' }
		}, { site: site.id });

		const { item: form } = await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'ljhfgdg',
				action: {
					method: 'block.save',
					parameters: {
						id: page.id,
						type: "page",
						content: { title: 'page test' }
					}
				},
				redirection: {
					name: 'two',
					parameters: { // TODO rename parameters to query here
						// action.response could be used directly
						// instead of having another layer of variables
						// however, when redirecting externally,
						// this is necessary
						// so it is always good practice to separate
						// redirection.query from action.response
					}
				}
			}
		}, { site: site.id });

		const { item: form2 } = await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'two',
				action: {
					method: 'block.save',
					parameters: {
						id: page2.id,
						type: "page",
						content: { title: 'page test 2' }
					}
				}
			}
		}, { site:site.id });

		const bpost = await app.run('apis.post', {
			name: form.data.name,
			query: {
				id: page.id
			}
		}, { site: site.id });
		assert.equal(bpost.item.id, page2.id);
		assert.equal(bpost.item.content.title, 'page test 2');
	});

	test('Add block with parent id in request', async function () {
		const { item: event } = await app.run('block.add', {
			type: 'event',
			data: { title: 'event title' }
		}, { site: site.id });
		const { item: form } = await app.run('block.add', {
			type: 'api_form',
			data: {
				name: 'form1',
				action: {
					method: 'block.add',
					parameters: {
						type: 'event_date',
						parents: [{ type: 'event' }]
					},
					request: {
						'parents.0.id': "[$request.id]"
					}
				}
			}
		}, { site: site.id });

		const bpost = await app.run('apis.post', {
			name: form.data.name,
			body: {
				id: event.id
			}
		}, { site: site.id });
		const { item } = await app.run('block.find', {
			type: "event_date",
			parent: {
				type: 'event',
				id: event.id
			}
		}, { site: site.id });
		assert.equal(item.id, bpost.item.id);
	});

});
