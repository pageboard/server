module.exports = function render(page, settings, req, res) {
	page.on('idle', async () => {
		const { status, statusText } = await page.evaluate(async () => {
			// eslint-disable-next-line no-undef
			const state = await Page.paint();
			if (state.status != 200) {
				return { status: state.status, statusText: state.statusText };
			}
			const all = await Promise.allSettled(state.scope.reveals);
			const errors = all.filter(({ reason }) => Boolean(reason));
			if (errors.length) return {
				status: 400,
				statusText: "Missing resources:\n" + errors.map(({ reason }) => reason.message).join('\n')
			};
		});
		if (status && status != 200) {
			const err = new Error(statusText);
			err.statusCode = status < 400 ? 400 : status;
			throw err;
		}
	});
};
