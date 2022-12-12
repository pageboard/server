module.exports = function upcachePlugin(page, settings, req, res) {
	const lockSet = new Set();
	const tagSet = new Set();
	page.on('response', async response => {
		const locks = await response.headerValue('X-Upcache-Lock');
		if (locks) for (const str of locks.split(',')) lockSet.add(str.trim());
		const tags = await response.headerValue('X-Upcache-Tag');
		if (tags) for (const str of tags.split(',')) tagSet.add(str.trim());
	});
	page.on('idle', () => {
		if (lockSet.size) req.call("auth.headers", [...lockSet]);
		if (tagSet.size) req.tag(...tagSet);
	});
};
