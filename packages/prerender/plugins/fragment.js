module.exports = function fragmentPlugin(page, settings, request) {
	var fragment = request.query.fragment;
	if (!fragment) return;
	page.when('idle', function() {
		return page.run(function(fragment, done) {
			var node = document.querySelector(fragment);
			if (!node) {
				var err = new Error("fragment not found");
				err.code = 400;
				return done(err);
			}
			done(null, node.outerHTML);
		}, fragment).then(function(html) {
			settings.output = html;
		});
	});
};

