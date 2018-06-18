Pageboard.elements.site = {
	properties : {
		title: {
			title: 'Site title',
			anyOf: [{type: "null"}, {type: "string"}]
		},
		domain: {
			title: 'Domain name',
			anyOf: [{
				type: "null",
			}, {
				type: "string",
				format: 'hostname'
			}]
		},
		alt: {
			title: 'Alt domain name',
			description: 'redirects to domain',
			anyOf: [{
				type: "null",
			}, {
				type: "string",
				format: 'hostname'
			}]
		},
		lang: {
			title: 'Language',
			anyOf: [{type: "null"}, {type: "string"}]
		},
		module: {
			title: 'Module name',
			anyOf: [{type: "null"}, {type: "string"}]
		},
		version: {
			title: 'Module version',
			description: 'Semantic version or git tag or commit',
			anyOf: [{
				type: "null"
			}, {
				type: "string" // TODO patterns, see core
			}]
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
			anyOf: [{
				type: "null"
			}, {
				type: "string",
				pattern: "^(/[\\w-.]*)+$"
			}],
			input: {
				name: 'href',
				display: 'icon',
				filter: {
					type: ["image", "svg"],
					maxSize: 20000,
					maxWidth: 320,
					maxHeight: 320
				}
			}
		}
	}
};

