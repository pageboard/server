const jsonDoc = require.lazy('../lib/json-doc');

module.exports = class HelpService {
	static name = 'help';
	static $global = true;

	constructor(app) {
		this.app = app;
	}

	command(req, { command }) {
		let schema;
		const [modName, funName] = (command || "").split('.');
		if (!funName) {
			schema = {
				properties: Object.fromEntries(
					Object.entries(this.app.services).map(([name, schema]) => {
						if (modName && modName != name) return [name, undefined];
						return [name, { type: "", title: Object.keys(schema) }];
					}).sort((a, b) => a[0].localeCompare(b[0]))
				)
			};
		} else {
			schema = this.app.api.getService(command)?.[0]?.properties?.parameters;
		}
		return jsonDoc(this.app.elements, command, schema, this.app.opts.cli);
	}
	static command = {
		title: 'Document command',
		$private: true,
		properties: {
			command: {
				title: 'Command',
				type: 'string'
			}
		}
	};
};
