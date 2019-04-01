module.exports = function(mw, settings, request, response) {
	if (request.query.email === undefined) return;
	settings.load.plugins = [
		All.dom.plugins.prerender,
		mailPlugin
	];
};

function mailPlugin(page, settings, request, response) {
	 page.when('idle', function() {
		return page.run(function(done) {
			done(null, {
				errors: document.errors && document.errors.length ? document.errors : null,
				title: document.title,
				text: document.text,
				html: document.html
			});
		}).then(function(obj) {
			if (obj.errors) console.error(obj.errors);
			settings.output = false;
			response.json(obj);
		}).catch(function(err) {
			console.error(err);
			settings.output = err;
			response.status(500);
		});
	});
};

