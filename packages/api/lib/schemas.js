exports.site = {
	title: 'Site',
	$lock: true,
	bundle: true,
	properties: {
		module: {
			title: 'Module name',
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
		}
	}
};
