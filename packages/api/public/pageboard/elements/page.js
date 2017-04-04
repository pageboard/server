(function(exports) {
	exports.page = {
		title: 'Page',
		properties: {
			title: {
				title: 'Title',
				type: ['string', 'null']
			},
			url: {
				title: 'Address',
				type: "string",
				pattern: "(\/[a-zA-Z0-9-.]*)+"
			}
		},
		contents: {
			body: {
				spec: 'block+',
				title: 'Body'
			}
		}
	};
})(typeof exports == "undefined" ? window.Pagecut.modules : exports);

