module.exports = function(page, settings, req, res) {
	settings.track = async function() {
		const { Page } = window;
		if (!Page) {
			const err = new Error("blank site");
			err.statusCode = 501;
			throw err;
		}
		try {
			if (document.hidden) {
				await Page.patch();
			} else {
				await Page.paint();
			}
		} catch (err) {
			console.error(err.toString(), err.stack);
		}
	};
	page.on('idle', async () => {
		const obj = await page.evaluate(async () => {
			const { Page: state } = window;
			try {
				if (state.constructor.serialize) {
					return state.constructor.serialize(state);
				} else return {
					mime: "text/html",
					body: '<!DOCTYPE html>\n' + document.documentElement.outerHTML
				};
			} catch (err) {
				console.error(err.toString(), err.stack);
			}
		});
		if (!obj) throw new HttpError.BadRequest("Empty response");
		if (obj.mime && obj.mime != "text/html") {
			// browsers revalidate only html by default
			res.append("Cache-Control", "must-revalidate");
		}
		if (obj.mime) res.type(obj.mime);
		res.send(obj.body);
	});
};

