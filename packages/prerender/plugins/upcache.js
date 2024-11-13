module.exports = function upcachePlugin(page, settings, req, res) {
	const tagSet = new Set();
	page.on('response', async response => {
		try {
			const tags = await response.headerValue('X-Upcache-Tag');
			if (tags) for (const str of tags.split(',')) tagSet.add(str.trim());
		} catch {
			// pass
		}
	});
	page.on('idle', () => {
		if (tagSet.size) req.tag(...tagSet);
	});
};
