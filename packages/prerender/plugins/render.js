module.exports = function render(page) {
	page.on('idle', async () => {
		await page.evaluate(() => {
			return new Promise(resolve => {
				// eslint-disable-next-line no-undef
				Page.paint(state => {
					state.finish(() => {
						Promise.all(state.scope.reveals ?? []).finally(resolve);
					});
				});
			});
		});
	});
};
