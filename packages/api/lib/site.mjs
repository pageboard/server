export const site = {
	title: 'Site',
	bundle: true,
	standalone: true,
	$lock: {}, // needed for other elements that add properties
	properties: {
		title: {
			title: 'Site title',
			nullable: true,
			type: "string"
		},
		domains: {
			title: 'Domain names',
			description: 'The main domain and the redirecting ones if any',
			nullable: true,
			type: "array",
			items: {
				type: "string",
				format: 'hostname'
			}
		},
		module: {
			title: 'Module name',
			description: 'npm name, or git url',
			nullable: true,
			type: "string",
			format: "singleline"
		},
		version: {
			title: 'Module version',
			description: 'Semantic version or git tag or commit',
			nullable: true,
			type: "string",
			format: "singleline" // a "version" format ?
		},
		server: {
			title: 'Server version',
			description: 'Major.minor pageboard server version',
			nullable: true,
			type: "string",
			pattern: /^\d+\.\d+$/.source
		},
		lang: {
			title: 'Locale',
			description: 'Single language',
			nullable: true,
			type: "string",
			format: 'lang'
		},
		languages: {
			title: 'Languages',
			description: 'Default language must be first',
			type: 'array',
			items: {
				type: 'string',
				format: 'lang'
			},
			nullable: true
		},
		env: {
			title: 'Environment',
			anyOf: [{
				const: 'dev',
				title: 'Development'
			}, {
				const: 'staging',
				title: 'Staging'
			}, {
				const: 'production',
				title: 'Production'
			}],
			default: 'dev'
		},
		favicon: {
			title: 'Favicon',
			nullable: true,
			type: "string",
			format: "pathname",
			$helper: {
				name: 'href',
				display: 'icon',
				filter: {
					type: ["image", "svg"],
					maxSize: 20000,
					maxWidth: 320,
					maxHeight: 320
				}
			}
		},
		author: {
			title: 'Author',
			nullable: true,
			type: "string",
			format: "singleline"
		},
		license: {
			title: 'License',
			nullable: true,
			type: "string",
			format: "singleline"
		},
		extra: {
			title: 'Extra settings',
			type: 'object',
			additionalProperties: {
				type: 'string'
			},
			properties: {}
		}
	}
};


