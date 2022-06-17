const assert = require('node:assert');
const Pageboard = require('..');

suite('run', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	test('validate data', async function() {
		const { command, data } = Pageboard.parse([
			"--site=test",
			"fake.command",
			"str=myval",
			"data.list=one",
			"data.list=two"
		]);
		Pageboard.defaults.plugins.push(__dirname + '/helpers/plugin.js');
		const app = new Pageboard();
		await app.init();

		const ret = await app.run(command, data);
		assert.deepEqual(ret, data);
	});

});
