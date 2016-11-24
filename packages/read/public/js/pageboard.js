Page.route(function(state) {
	return GET('/api/page', {
		url: state.pathname
	}).then(function(page) {
		console.log(page);
	});
});
