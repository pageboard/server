const assert = require('node:assert');
const { site, setupApp } = require('./helpers/common');

suite('archive', function () {
	this.timeout(require('node:inspector').url() === undefined ? 20000 : 0);

	suiteSetup(setupApp);

	test('bundle from apis.get', async function () {
		// TODO
		// ./bin/pageboard.js --grant=root --site=myse archive.bundle name=inventory-items query.id=9f6e5320012b882d query.lang=fr query.limit=1000 size=m
	});

});
