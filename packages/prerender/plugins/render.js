module.exports = function render(page, settings, req, res) {
	page.on('idle', async () => {
		const { status, statusText } = await page.evaluate(async isDev => {
			// eslint-disable-next-line no-undef
			const state = await Page.paint();
			const { status, statusText } = state;
			const result = { status, statusText };
			if (status == 200) {
				const all = await Promise.all(state.scope.reveals ?? []);
				const errors = all.filter(e => e?.name);
				if (errors.length) {
					const msg = `Errors rendering ${errors.length} files`;
					if (isDev) {
						console.warn(msg, "(ignored)");
					} else {
						result.status = 400;
						result.statusText = msg;
					}
				}
			}
			return result;
		}, req.site.data.env == "dev");
		if (status > 200) {
			throw new HttpError[status](statusText);
		}
	});
};
