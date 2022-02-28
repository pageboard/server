const { cli, genId, merge } = require('../common');

describe('test site api through cli', () => {
	const id = genId();
	const site = {
		id,
		data: { env: 'dev' },
		type: 'site',
		standalone: true
	};

	test('site does not exist', async () => {
		expect.assertions(1);
		try {
			await cli('site.get', `id=${id}`);
		} catch (e) {
			expect(e.message).toMatch('NotFoundError');
		}
	});

	test('add site', async () => {
		const add = await cli('site.add', `id=${id}`, `data.env=dev`);
		expect(add).toStrictEqual(site);
	});

	test('site does exist', async () => {
		const get = await cli('site.get', `id=${id}`);
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
		const save = await cli('site.save', `id=${id}`, 'data.lang=en');
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
		const del = await cli('site.del', `id=${id}`);
		expect(del).toStrictEqual({
			blocks: 1
		});
	});


	afterAll(async () => {
		// cleanup
		try {
			cli('site.del', `id=${id}`);
		} catch (err) {
			// pass
		}
	});
});
