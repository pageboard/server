const traverse = require.lazy('json-schema-traverse');
const { table, getBorderCharacters } = require('table');

module.exports = function(schemas, api, schema, formatted) {
	if (!schema) return;
	const lines = [];
	const header = {};
	header.content = schema.title ?? '';

	traverse(schema, {
		cb(schema, pointer, root, parentPointer, keyword, parent, name) {
			const { $ref } = schema;
			if ($ref) {
				const prefix = '#/definitions/';
				if ($ref?.startsWith(prefix)) {
					delete schema.$ref;
					const [name, ...rel] = $ref.slice(prefix.length).split("/");
					let ref = schemas[name];
					if (ref) {
						ref = rel.reduce((schema, key) => schema[key], ref);
					}
					if (ref) Object.assign(schema, ref);
					else console.error("$ref not found", $ref);
				}
			}
			if (keyword == "properties") {
				if (parentPointer?.startsWith('/definitions/')) return;
				const required = (parent && parent.required || []).includes(name);
				let type = schema.type;
				if (typeof type != "string") {
					type = 'object';
				} else if (type == "object" && schema.properties) {
					type = "";
				} else if (schema.anyOf) {
					const consts = schema.anyOf.map(item => item.const);
					if (consts.length == schema.anyOf.length) {
						type = consts.join(', ');
					}
				}
				const path = pointer.split('/').slice(1).filter(x => x != 'properties').join('.');
				if (schema.default) type += `|${JSON.stringify(schema.default)}`;
				if (!api) lines.push([path, schema.title]);
				else if (!type) lines.push([path, 'object', schema.title]);
				else lines.push([path + (required ? ' *' : ''), type, schema.title || '-']);
			}
		}
	});

	if (!formatted) {
		return header.content + '\n' + lines.join('\n');
	} else {
		if (lines.length == 0) lines.push(["missing properties"]);
		return table(lines, {
			header,
			drawHorizontalLine: (index, size) => {
				const dec = header.content != null ? 1 : 0;
				if (index <= dec || index >= size) return true;
				return lines[index - dec][1] === "";
			},
			border: getBorderCharacters('norc')
		});
	}
};


