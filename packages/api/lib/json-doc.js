const traverse = require('json-schema-traverse');

module.exports = function(schema) {
	if (!schema) return;
	var indent = 1;
	var lines = [''];

	traverse(schema, {
		cb: cb
	});

	function cb(schema, pointer, root, parentPointer, keyword, parent, name) {
		var line = (new Array(indent + 1)).join(' ');
		if (!pointer && schema.required) {
			line += `required: ${schema.required.join(', ')}`;
		} else if (keyword == "properties") {
			if (schema.title) {
				var type = schema.type;
				if (typeof type == "string") type = `<${type}>`;
				else type = '<object>';
				line += `${name}\t${type} \t ${schema.title}`;
			}
		}
		lines.push(line);
	}
	return lines.join('\n');
};


