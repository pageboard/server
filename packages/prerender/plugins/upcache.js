module.exports = function upcachePlugin(page, settings, req, res) {
	const lockSet = new Set();
	const tagSet = new Set();
	page.on('response', async response => {
		const locks = await response.headerValues('X-Upcache-Lock');
		for (const str of locks) lockSet.add(str);
		const tags = await response.headerValues('X-Upcache-Tag');
		for (const str of tags) tagSet.add(str);
	});
	page.on('idle', () => {
		if (lockSet.size) req.call("auth.headers", [...lockSet]);
		if (tagSet.size) req.tag(...tagSet);
	});
};
