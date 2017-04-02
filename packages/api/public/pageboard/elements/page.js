(function(exports) {
	exports.page = {
		title: 'Page',
		properties: {
			title: {
				type: ['string', 'null']
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

