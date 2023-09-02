export const user = {
	title: 'User',
	priority: -10,
	bundle: true,
	standalone: true,
	required: ['email'],
	properties: {
		email: {
			title: 'Email',
			type: 'string',
			format: 'email',
			transform: ['trim', 'toLowerCase']
		},
		name: {
			title: 'Name',
			type: 'string',
			nullable: true,
			format: 'singleline'
		}
	}
};

export const priv = {
	title: 'Private',
	priority: -10,
	$lock: true,
	standalone: true,
	properties: {
		otp: {
			type: 'object',
			properties: {
				secret: {
					type: 'string'
				},
				checked_at: {
					nullable: true,
					type: 'string',
					format: 'date-time'
				},
				tries: {
					type: 'integer',
					default: 0
				}
			}
		}
	},
	parents: {
		type: 'array',
		items: [{
			type: 'object',
			properties: {
				type: {
					title: 'User',
					const: 'user'
				},
				id: {
					title: 'id',
					type: 'string',
					format: 'id'
				}
			}
		}]
	}
};


export const settings = {
	title: 'Settings',
	priority: -10,
	bundle: 'user',
	standalone: true,
	properties: {
		consents: {
			title: 'User Consents',
			type: 'object',
			properties: {
				mandatory: {
					title: 'Mandatory Contacts',
					type: 'boolean',
					default: false
				},
				extra: {
					title: 'Extra Contacts',
					type: 'boolean',
					default: false
				}
			}
		},
		grants: {
			title: 'Grants',
			type: 'array',
			uniqueItems: true,
			nullable: true,
			items: {
				anyOf: [{
					const: 'root',
					$level: 1,
					title: 'Root',
					description: 'anything'
				}, {
					const: 'owner',
					$level: 10,
					title: 'Owner',
					description: 'site owner'
				}, {
					const: 'webmaster',
					$level: 100,
					title: 'Webmaster',
					description: 'site developer'
				}, {
					const: 'writer',
					$level: 1000,
					title: 'Writer',
					description: 'content editor'
				}, {
					const: 'translator',
					$level: 2000,
					title: 'Translator',
					description: 'translator'
				}, {
					const: 'reader',
					$level: 5000,
					title: 'Reader',
					description: 'restricted content'
				}, {
					const: 'user',
					$level: 10000,
					title: 'User',
					description: 'public user'
				}]
			}
		}
	},
	parents: {
		type: 'array',
		items: [{
			type: 'object',
			properties: {
				type: {
					title: 'User',
					const: 'user'
				},
				id: {
					title: 'id',
					type: 'string',
					format: 'id'
				}
			}
		}]
	}
};


