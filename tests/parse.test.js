const assert = require('node:assert');
const Pageboard = require('..');

suite('parse', function () {

	this.timeout(require('node:inspector').url() === undefined ? 10000 : 0);

	test('parse arguments', async function() {
		const { command, opts, data } = Pageboard.parse([
			"--database=postgres:test@localhost/test",
			"--site=test",
			"fake.command",
			"str=myval",
			"data.list=one",
			"data.list=two"
		]);
		assert.deepEqual(opts, {
			site: 'test',
			database: 'postgres:test@localhost/test'
		});
		assert.equal(command, 'fake.command');
		assert.deepEqual(data, { str: 'myval', data: { list: ["one", "two"] } });
	});

});
