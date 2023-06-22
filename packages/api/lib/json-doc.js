const traverse = require('json-schema-traverse');
const { table, getBorderCharacters } = require('table');

module.exports = function(api, schema, formatted) {
	if (!schema) return;
	const lines = [];
	const header = {};
	if (api && schema.title) header.content = `${api}: ${schema.title}`;

	traverse(schema, {
		cb(schema, pointer, root, parentPointer, keyword, parent, name) {
			if (keyword == "properties") {
				const required = (parent && parent.required || []).includes(name);
				let type = schema.type;
				if (typeof type != "string") type = 'object';
				else if (type == "object" && schema.properties) type = "";
				const path = pointer.split('/').slice(1).filter(x => x != 'properties').join('.');
				if (schema.default) type += `|${JSON.stringify(schema.default)}`;
				if (!type) lines.push([path, schema.title]);
				else lines.push([path + (required ? ' *' : ''), type, schema.title || '-']);
			}
		}
	});

	if (lines.length == 0) return "";
	else if (!formatted) return lines.join('\n');
	else return table(lines, {
		header,
		drawHorizontalLine: (index, size) => {
			const dec = header.content != null ? 1 : 0;
			if (index <= dec || index >= size) return true;
			return lines[index - dec][1] === "";
		},
		border: getBorderCharacters('norc')
	});
};


