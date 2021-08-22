var flat = require('flat');


exports.unflatten = function(query) {
	return flat.unflatten(query, {
		object: true,
		maxDepth: 8
	});
};

exports.mergeParameters = mergeParameters;

function mergeParameters(params, obj) {
	const ret = Array.isArray(params) ? [] : {};
	Object.entries(params).forEach(function([key, val]) {
		if (val == null) return;
		if (typeof val == "string") {
			val = All.utils.fuse(val, obj);
			if (val != null) ret[key] = val;
		} else if (typeof val == "object") {
			ret[key] = mergeParameters(val, obj);
		} else {
			ret[key] = val;
		}
	});
	return ret;
}

exports.mergeObjects = mergeObjects;

function mergeObjects(data, expr) {
	if (data == null) return expr;
	var copy = Array.isArray(data) ? data.slice() : Object.assign({}, data);
	if (expr != null) Object.entries(expr).forEach(function([key, val]) {
		if (val == null) return;
		else if (typeof val == "object") {
			copy[key] = mergeObjects(copy[key], val);
		} else {
			copy[key] = val;
		}
	});
	return copy;
}
