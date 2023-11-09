module.exports = function render(page, settings, req, res) {
	page.on('idle', async () => {
		const { status, statusText } = await page.evaluate(async () => {
			// eslint-disable-next-line no-undef
			const state = await Page.paint();
			const { status, statusText } = state;
			const result = { status, statusText };
			if (status == 200) {
				const all = await Promise.all(state.scope.reveals);
				const errors = all.filter(url => Boolean(url));
				if (errors.length) {
					result.status = 400;
					result.statusText = "Missing resources:\n" + errors.join('\n');
				}
			}
			return result;
		});
		if (status && status != 200) {
			const err = new Error(statusText);
			err.statusCode = status < 400 ? 400 : status;
			throw err;
		}
	});
};
