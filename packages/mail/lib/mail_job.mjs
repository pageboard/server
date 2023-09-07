export const mail_job = {
	title: 'Mail Job',
	bundle: true,
	standalone: true,
	required: ['url', 'to'],
	properties: {
		response: {
			title: 'Response',
			type: 'object',
			properties: {
				status: {
					title: 'Status',
					type: 'integer',
					nullable: true
				},
				text: {
					title: 'Text',
					type: 'string',
					nullable: true
				}
			}
		},
		purpose: {
			title: 'Purpose',
			anyOf: [{
				title: "Transactional",
				const: "transactional"
			}, {
				title: "Conversations",
				const: "conversations"
			}, {
				title: "Subscriptions",
				const: "subscriptions"
			}],
			default: 'transactional'
		},
		from: {
			title: 'From',
			description: 'User settings.id or email',
			anyOf: [{
				type: 'string',
				format: 'id'
			}, {
				type: 'string',
				format: 'email'
			}]
		},
		replyTo: {
			title: 'Reply To',
			description: 'Email address or user id',
			anyOf: [{
				type: 'string',
				format: 'id'
			}, {
				type: 'string',
				format: 'email'
			}]
		},
		to: {
			title: 'To',
			description: 'List of email addresses or users id',
			type: 'array',
			items: {
				anyOf: [{
					type: 'string',
					format: 'id'
				}, {
					type: 'string',
					format: 'email'
				}]
			}
		},
		url: {
			title: 'Mail page',
			type: "string",
			format: "pathname",
			$filter: {
				name: 'helper',
				helper: {
					name: 'page',
					type: 'mail'
				}
			},
			$helper: 'href'
		},
		subject: {
			title: 'Subject',
			description: 'Defaults to mail page title',
			type: 'string',
			nullable: true
		},
		body: {
			title: 'Query',
			type: 'object',
			default: {}
		}
	}
};
