export const site = {
	title: 'Site',
	bundle: true,
	standalone: true,
	priority: -1000, // way before page group
	$lock: {}, // needed for other elements that add properties
	csp: {
		default: ["'none'"],
		'form-action': ["'self'"],
		'frame-ancestors': ["'self'"],
		connect: ["'self'"],
		object: ["'none'"],
		script: ["'self'"],
		frame: ["https:"],
		style: ["'self'", "'unsafe-inline'"],
		font: ["'self'", "data:", "https:"],
		img: ["'self'", "data:", "https:"]
	},
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
		dependencies: {
			title: 'Dependencies',
			type: 'object',
			additionalProperties: {
				type: 'string',
				format: 'singleline',
				nullable: true
			}
		},
		versions: {
			title: 'Versions',
			type: 'object',
			additionalProperties: {
				type: 'string',
				format: 'version'
			}
		},
		hash: {
			title: 'Hash',
			type: 'string',
			format: 'name'
		},
		server: {
			title: 'Server version',
			nullable: true,
			type: "string",
			format: 'version'
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
