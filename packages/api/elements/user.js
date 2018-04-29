Pageboard.elements.user = {
	required: ['email', 'nickname', 'name'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		session: {
			type: 'object',
			properties: {
				done: {
					type: 'boolean',
					default: false
				},
				hash: {
					type: ['string', 'null']
				},
				referer: {
					type: 'string',
					format: 'uri'
				}
			}
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
		}
	}
};

Pageboard.elements.settings = {
	properties : {
		grants: {
			type: 'array',
			uniqueItems: true,
			items: {
				anyOf: [{
					const: 'owner',
					title: 'Owner'
				}, {
					const: 'webmaster',
					title: 'Webmaster'
				}]
			}
		}
	}
};

