module.exports = function(page, settings, request, response) {
	page.when('idle', function() {
		if (settings.output == null) return page.run(function(done) {
			// could use Page.finish().then() the day all clients use window-page@9.2.0
			Page.init(function(state) {
				state.queue.then(function(state) {
					if (Page.serialize) return Page.serialize(state);
					else return {
						mime: "text/html",
						body: '<!DOCTYPE html>\n' + document.documentElement.outerHTML
					};
				}).then(function(doc) {
					done(null, doc);
				}).catch(function(err) {
					console.error(err); // FIXME else nobody can actually see the error
					done(err);
				});
			});
		}).then(function(obj) {
			if (!obj) throw new HttpError.BadRequest("Empty response");
			// backward compatibility with old clients
			if (typeof obj == "string") obj = {
				mime: settings.mime || "text/html",
				body: obj
			};
			settings.output = false;
			if (obj.mime) response.type(obj.mime);
			response.send(obj.body);
		});
	});
};

