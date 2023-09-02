const jsonDoc = require.lazy('../lib/json-doc');

module.exports = class HelpService {
	static name = 'help';
	static $global = true;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	doc(req, { command, schema }) {
		return jsonDoc(this.app.api.schemas, command, schema, this.app.opts.cli);
	}
	static doc = {
		title: 'Get json doc',
		$lock: true,
		required: ['command', 'schema'],
		properties: {
			command: {
				title: 'Command',
				type: 'string'
			},
			schema: {
				title: 'Schema',
				type: 'object'
			}
		}
	};

	command(req, { command }) {
		let schema;
		const [modName, funName] = (command || "").split('.');
		if (!funName) {
			schema = {
				properties: Object.fromEntries(
					Object.entries(this.app.services).map(([name, schema]) => {
						if (modName && modName != name) return [name, undefined];
						return [name, { type: "", title: Object.keys(schema) }];
					})
				)
			};
		} else {
			schema = this.app.api.getService(req, command)[0];
		}
		return this.doc(req, { command, schema });
	}
	static command = {
		title: 'Help on command',
		$lock: true,
		properties: {
			command: {
				title: 'Command',
				type: 'string'
			}
		}
	};
};
