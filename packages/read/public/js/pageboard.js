Page.route(function(state) {
	return GET('/api/page', {
		url: state.pathname
	}).then(function(page) {
		return GET({
			url: page.template,
			type: 'html'
		});
	}).then(function(doc) {
		state.document = doc;
	});
});
