module.exports = class StatService {
	static name = 'stat';

	apiRoutes(router) {
		router.write('/stat/beacons', 'stat.beacons');
	}

	async beacons({ site, sql: { trx, raw, ref, fun } }, { names }) {
		if (names.length == 0) throw new HttpError.BadRequest("Empty names");
		const ret = await site.$relatedQuery('children', trx)
			.where('type', 'statistic')
			.whereIn(ref('data:name').castText(), names)
			.patch({
				'type': 'statistic',
				'data:value': raw('?? + ?', [fun('coalesce', ref('data:value').castInt(), 0), 1]),
			});
		if (ret != names.length) throw new HttpError.NotFound(names.join(", "));
		return {};
	}

	static beacons = {
		title: 'Beacons',
		$action: 'write',
		required: ['names'],
		properties: {
			names: {
				title: 'Names of stats to increment',
				type: 'array',
				items: {
					type: 'string',
					format: 'singleline'
				}
			}
		}
	};
};
