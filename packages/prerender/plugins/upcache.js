module.exports = function upcachePlugin(page, settings, req, res) {
	const lockSet = new Set();
	const tagSet = new Set();
	page.on('response', async response => {
		try {
			const locks = await response.headerValue('X-Upcache-Lock');
			if (locks) for (const str of locks.split(',')) lockSet.add(str.trim());
			const tags = await response.headerValue('X-Upcache-Tag');
			if (tags) for (const str of tags.split(',')) tagSet.add(str.trim());
		} catch {
			// pass
		}
	});
	page.on('idle', () => {
		if (lockSet.size) req.locks.push(...lockSet);
		if (tagSet.size) req.tag(...tagSet);
	});
};
