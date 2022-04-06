module.exports = function(page, settings, request, response) {
	page.when('idle', () => {
		if (settings.output == null) return page.run(done => {
			const { Page } = window;
			if (!Page) {
				const err = new Error("blank site");
				err.statusCode = 501;
				return done(err);
			}
			Page.finish().then(state => {
				if (Page.serialize) {
					return Page.serialize(state);
				} else return {
					mime: "text/html",
					body: '<!DOCTYPE html>\n' + document.documentElement.outerHTML
				};
			}).then((doc) => {
				done(null, doc);
			}).catch((err) => {
				console.error(err); // FIXME else nobody can actually see the error
				done(err);
			});
		}).then((obj) => {
			if (!obj) throw new HttpError.BadRequest("Empty response");
			// backward compatibility with old clients
			if (typeof obj == "string") obj = {
				mime: settings.mime || "text/html",
				body: obj
			};
			settings.output = false;
			if (obj.mime && obj.mime != "text/html") {
				// browsers revalidate only html by default
				response.set("Cache-Control", "must-revalidate");
			}
			if (obj.mime) response.type(obj.mime);
			response.send(obj.body);
		});
	});
};

