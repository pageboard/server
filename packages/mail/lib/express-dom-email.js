module.exports = function(mw, settings, request, response) {
	if (request.path.endsWith('.mail') == false) return;
	settings.load.plugins = [
		All.dom.plugins.upcache,
		All.dom.plugins.hide,
		All.dom.plugins.bearer,
		All.dom.plugins.prerender,
		mailPlugin
	];
};

function mailPlugin(page, settings, request, response) {
	page.when('idle', function() {
		return page.run(function(done) {
			var doc = document;
			done(null, {
				errors: doc.errors && doc.errors.length ? doc.errors : null,
				title: doc.title,
				text: doc.text,
				html: doc.html
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
}

