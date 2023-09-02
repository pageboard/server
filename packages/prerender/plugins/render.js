module.exports = function render(page, settings) {
	page.on('idle', async () => {
		await page.evaluate(async () => {
			// eslint-disable-next-line no-undef
			const state = await Page.paint();
			await state.scope.reveals;
		});
	});
};
