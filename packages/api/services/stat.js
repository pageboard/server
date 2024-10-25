module.exports = class StatService {
	static name = 'stat';

	async inc({ site, sql: { trx, raw, ref, fun }}, data) {
		const ret = await site.$relatedQuery('children', trx)
			.where('type', 'statistic')
			.where(ref('data:name').castText(), data.name)
			.patch({
				'type': 'statistic',
				'data:value': raw('?? + ?', [fun('coalesce', ref('data:value').castInt(), 0), 1]),
			});
		if (ret != 1) throw new HttpError.NotFound();
		return {};
	}
	static inc = {
		title: 'Increment',
		$action: 'write',
		required: ['name'],
		properties: {
			name: {
				title: 'Name of stat',
				type: 'string',
				format: 'name'
			}
		}
	};
};
