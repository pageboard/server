Pageboard.elements.site = {
	required: ['domain'],
	properties : {
		title: {
			title: 'Site title',
			type: 'string' // the site public name
		},
		domain: {
			title: 'Domain name',
			type: 'string'
		},
		module: {
			title: 'Module name',
			type: 'string'
		},
		version: {
			title: 'Module version',
			type: 'string'
		},
		production: {
			title: 'Production',
			type: 'boolean',
			default: false
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

