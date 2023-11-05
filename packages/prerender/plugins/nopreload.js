module.exports = function (page) {
	page.on('idle', async () => {
		await page.evaluate(() => {
			for (const node of document.head.querySelectorAll('link[rel="preload"]')) {
				node.remove();
			}
		});
	});
};
