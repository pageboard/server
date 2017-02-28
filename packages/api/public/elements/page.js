(function(exports) {
	exports.page = {
		view: function(doc, block) {
			return doc.documentElement;
		},
		required: ['template'],
		properties: {
			title: {
				type: ['string', 'null']
			},
			template: {
				type: 'string'
			}
		}
	};
})(typeof exports == "undefined" ? window.Pagecut.modules : exports);

