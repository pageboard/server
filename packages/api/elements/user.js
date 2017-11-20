Pageboard.elements.user = {
	required: ['email', 'password', 'nickname', 'name'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		verification: {
			type: ['string', 'null']
		},
		origin: {
			type: ['string', 'null'] // TODO the form id? type? that created this user
			// could be registration, contact, newsletter forms...
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

