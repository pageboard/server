const assert = require('node:assert');
const { site, nullers, setupApp } = require('./helpers/common');

suite('git', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	suiteSetup(setupApp);

	test('decide install', async function () {
		// TODO
		try {
			await app.run('site.add', site);
		} catch (err) {
			// pass
		}
		const get = await app.run('site.get', { id: site.id });
		assert.equal(typeof get.updated_at, "string");
		assert.deepEqual({ ...get.toJSON(), ...nullers }, { ...site, ...nullers });
	});

	test('install commit from branch', async function () {

	});

	test('fail to install commit from another branch', async function () {

	});

	test('fail to install commit with syntax errors in js/css', async function () {

	});

});
