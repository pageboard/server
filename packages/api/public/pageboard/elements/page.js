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
				format: "uri"
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

