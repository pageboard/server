const assert = require('node:assert');
const { site, app, setupHelper } = require('./helpers/common');

suite('apis.post', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	suiteSetup(setupHelper);

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
				action: {
					method: 'block.save',
					parameters: {
						id: page.id,
						type: "page",
						content: { title: 'page test' }
					}
				},
				redirection: {
					url: '/@api/form/two',
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
			name: form.id,
			query: {
				id: page.id
			}
		}, { site: site.id });
		assert.equal(bpost.item.id, page2.id);
		assert.equal(bpost.item.content.title, 'page test 2');
	});


});
