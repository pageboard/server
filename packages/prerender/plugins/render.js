module.exports = function render(page, settings, req, res) {
	page.on('idle', async () => {
		const { status, statusText } = await page.evaluate(async isDev => {
			// eslint-disable-next-line no-undef
			const state = await Page.paint();
			const { status, statusText } = state;
			const result = { status, statusText };
			if (status == 200) {
				const all = await Promise.all(state.scope.reveals ?? []);
				const errors = all.filter(e => e?.message);
				if (errors.length) {
					if (isDev) {
						console.warn("ignoring", errors.length, "reveal errors");
					} else {
						result.status = 400;
						result.statusText = "reveal errors:\n" + errors.join('\n');
					}
				}
			}
			return result;
		}, req.site.data.env == "dev");
		if (status > 200) {
			res.status(status);
			res.statusMessage = statusText;
		}
	});
};
