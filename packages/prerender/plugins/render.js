module.exports = function render(page) {
	page.on('idle', async () => {
		// wait for paint because it is after setup
		await page.evaluate(async () => {
			return new Promise(resolve => {
				Page.paint(state => state.finish(resolve));
			});
		});
	});
};
