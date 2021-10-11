module.exports = function upcachePlugin(page, settings, request, response) {
	const locksMap = {};
	const tagsMap = {};
	page.on('response', (res) => {
		let list = res.headers['X-Upcache-Lock'];
		if (list) list.split(',').forEach((str) => {
			locksMap[str.trim()] = true;
		});
		list = res.headers['X-Upcache-Tag'];
		if (list) list.split(',').forEach((str) => {
			tagsMap[str.trim()] = true;
		});
	});
	page.when('idle', () => {
		const locks = Object.keys(locksMap);
		if (locks.length) response.priv.locks = locks;
		const tags = Object.keys(tagsMap);
		if (tags.length) response.priv.tags = tags;
	});
};
