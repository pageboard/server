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
		env: {
			title: 'Production',
			type: 'boolean',
			default: false
		}
	}
};

