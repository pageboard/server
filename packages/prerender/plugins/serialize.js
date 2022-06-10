module.exports = function(page, settings, req, res) {
	page.on('idle', async () => {
		const obj = await page.evaluate(async () => {
			const { Page } = window;
			if (!Page) {
				const err = new Error("blank site");
				err.statusCode = 501;
				throw err;
			}
			const state = await Page.finish();
			if (Page.serialize) {
				let obj = await Page.serialize(state);
				// backward compatibility with old clients
				if (typeof obj == "string") obj = {
					mime: settings.mime || "text/html",
					body: obj
				};
				return obj;
			} else return {
				mime: "text/html",
				body: '<!DOCTYPE html>\n' + document.documentElement.outerHTML
			};
		});
		if (!obj) throw new HttpError.BadRequest("Empty response");
		if (obj.mime && obj.mime != "text/html") {
			// browsers revalidate only html by default
			res.set("Cache-Control", "must-revalidate");
		}
		if (obj.mime) res.type(obj.mime);
		res.send(obj.body);
	});
};

