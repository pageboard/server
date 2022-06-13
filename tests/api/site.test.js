const { cli, merge, destroySite } = require('../common');

// individual tests cannot be run separately
describe('site', () => {
	const site = {
		id: 'test',
		type: 'site',
		data: { env: 'dev' },
		standalone: true
	};


	beforeAll(async () => {
		try {
			await destroySite(site.id);
		} catch (err) {
			// ignore
		}
	});

	test('site does not exist', async () => {
		let result, err;
		try {
			result = await cli('site.get', `id=${site.id}`);
		} catch (e) {
			err = e;
		}
		expect(result).toBeUndefined();
		expect(err.message).toMatch('NotFoundError');
	});

	test('add site', async () => {
		const add = await cli('site.add', `id=${site.id}`, `data.env=dev`);
		expect(add).toStrictEqual(site);
	});

	test('site does exist', async () => {
		const get = await cli('site.get', `id=${site.id}`);
		expect(get.updated_at).toBeDefined();
		delete get.updated_at;
		const nsite = merge({}, site, {
			content: {},
			expr: null,
			lock: null
		});
		expect(get).toStrictEqual(nsite);
	});

	test('save site', async () => {
		const save = await cli('site.save', `id=${site.id}`, 'data.lang=en');
		expect(save.data.server).toBeDefined();
		delete save.data.server;
		expect(save.updated_at).toBeDefined();
		delete save.updated_at;
		const nsite = merge({}, site, {
			content: {},
			expr: null,
			lock: null,
			data: {
				lang: 'en'
			}
		});
		expect(save).toStrictEqual(nsite);
	});

	test('delete site', async () => {
		const del = await cli('site.del', `id=${site.id}`);
		expect(del).toStrictEqual({
			blocks: 1
		});
	});

});
