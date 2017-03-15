(function(exports) {

exports.user = {
	required: ['email', 'password', 'nickname', 'name'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		verification: {
			type: ['string', 'null']
		},
		password: {
			type: 'string'
		},
		nickname: {
			type: 'string'
		},
		name: {
			type: 'string'
		},
		picture: {
			type: 'string',
			format: 'uri'
		},
		grants: {
			type: 'array',
			items: {
				type: 'string'
			},
			uniqueItems: true,
			default: []
		}
	}
};

})(typeof exports == "undefined" ? window.Pagecut.modules : exports);
