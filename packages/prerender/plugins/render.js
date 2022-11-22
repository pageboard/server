module.exports = function render(page) {
	page.on('idle', async () => {
		// wait for paint because it is after setup
		await page.evaluate(async () => {
			return new Promise(resolve => {
				// eslint-disable-next-line no-undef
				Page.paint(state => state.finish(resolve));
			});
		});
	});
};
