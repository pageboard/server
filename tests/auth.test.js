const assert = require('node:assert');
const { site, setupApp } = require('./helpers/common');

suite('auth', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	suiteSetup(setupApp);

	test('grant, get token, verify it', async function () {
		const email = 'test@test.localhost.localdomain';
		const grant = 'webmaster';

		await app.run('settings.grant', {
			email, grant
		}, { site: site.id, grant: 'root' });

		const token = new URLSearchParams((await app.run('login.link', {
			email, grant
		}, { site: site.id, grant: 'root' })).split('?').pop()).get('token');

		const { item, cookies } = await app.run('login.verify', {
			email, grant, token
		}, { site: site.id });

		assert.ok(cookies.bearer.value);
		assert.ok(cookies.bearer.maxAge);
		assert.deepEqual(item.data.grants, [grant]);

	});




});
