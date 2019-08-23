module.exports = function(page, settings, request, response) {
	page.when('idle', function() {
		if (settings.output == null) return page.run(function(done) {
			Page.finish(function() {
				Promise.resolve().then(function() {
					if (Page.serialize) return Page.serialize();
					else return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
				}).then(function(doc) {
					done(null, doc);
				}).catch(done);
			});
		}).then(function(obj) {
			if (!obj) throw new HttpError.BadRequest("Empty response");
			settings.output = false;
			response.send(obj);
		});
	});
};

