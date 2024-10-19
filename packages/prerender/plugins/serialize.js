module.exports = function (page, settings, req, res) {
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
		const requestedType = req.accepts(['html', 'json']);
		const obj = await page.evaluate(async type => {
			const { Page: state } = window;
			try {
				if (state.constructor.serialize) {
					return state.constructor.serialize(state, type);
				} else return {
					mime: "text/html",
					body: '<!DOCTYPE html>\n' + document.documentElement.outerHTML
				};
			} catch (err) {
				console.error(err.toString(), err.stack);
			}
		}, requestedType);
		if (!obj?.mime) throw new HttpError.BadRequest("Invalid serialization");
		if (obj.mime != "text/html") {
			// browsers revalidate only html by default
			res.append("Cache-Control", "must-revalidate");
		}
		res.type(obj.mime);
		if (typeof obj.body == "string") res.send(obj.body);
		else res.json(obj.body);
	});
};

