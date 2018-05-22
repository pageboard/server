Pageboard.elements.user = {
	required: ['email'],
	properties: {
		email: {
			type: 'string',
			format: 'email',
			transform: ['trim', 'toLowerCase']
		}
	}
};

Pageboard.elements.settings = {
	properties: {
		grants: {
			type: 'array',
			uniqueItems: true,
			items: {
				anyOf: [{
					const: 'root',
					title: 'Root',
					description: 'Allowed to do anything'
				}, {
					const: 'owner',
					title: 'Owner',
					description: 'Allowed to modify site'
				}, {
					const: 'webmaster',
					title: 'Webmaster',
					description: 'Allowed to modify pages'
				}, {
					const: 'writer',
					title: 'Writer',
					description: 'Allowed to modify some public blocks'
				}, {
					const: 'user',
					title: 'User',
					description: 'Allowed to modify some private blocks'
				}]
			}
		},
		session: {
			type: 'object',
			properties: {
				grants: {
					// filled below
				},
				verified: {
					type: 'boolean',
					default: false
				},
				hash: {
					type: 'string'
				},
				referer: {
					anyOf: [{
						type: 'null'
					}, {
						type: 'string',
						format: 'uri'
					}]
				}
			}
		}
	}
};
Pageboard.elements.settings.properties.session.properties.grants = Pageboard.elements.settings.properties.grants;
