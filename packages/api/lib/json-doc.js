const traverse = require('json-schema-traverse');
const {table, getBorderCharacters} = require('table');

module.exports = function(opt, schema) {
	if (!schema) return;
	var lines = [];

	traverse(schema, {
		cb: cb
	});

	function cb(schema, pointer, root, parentPointer, keyword, parent, name) {
		if (keyword == "properties") {
			var required = (parent && parent.required || []).includes(name);
			var type = schema.type;
			if (typeof type != "string") type = 'object';
			else if (type == "object" && schema.properties) type = "";
			var path = pointer.split('/').slice(1).filter((x) => x != 'properties').join('.');
			lines.push([path + (required ? ' *' : ''), type, schema.title || '-']);
		}
	}
	if (lines.length == 0) return "";
	if (!opt.cli) return lines.join('\n');
	return table(lines, {
		drawHorizontalLine: (index, size) => {
			if (index == 0 || index == size) return true;
			return lines[index][1] === "";
		},
		border: getBorderCharacters('norc')
	});
};


