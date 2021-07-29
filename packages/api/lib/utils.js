const matchdom = require('matchdom');
const flat = require('flat');


exports.unflatten = function(query) {
	return flat.unflatten(query, {
		object: false,
		maxDepth: 8
	});
};

exports.mergeParameters = mergeParameters;

function mergeParameters(params, obj) {
	const ret = Array.isArray(params) ? [] : {};
	Object.entries(params).forEach(function([key, val]) {
		if (val == null) return;
		if (typeof val == "string") {
			val = matchdom(val, obj);
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
	const copy = Array.isArray(data) ? data.slice() : Object.assign({}, data);
	if (expr != null) Object.entries(expr).forEach(function([key, val]) {
		let sval = copy[key];
		if (val == null) return;
		else if (typeof val == "object") {
			if (Array.isArray(val)) {
				if (sval == null) sval = [];
				else if (!Array.isArray(sval)) sval = [sval];
			} else if (sval == null) {
				sval = {};
			}
			copy[key] = mergeObjects(sval, val);
		} else {
			copy[key] = val;
		}
	});
	return copy;
}


exports.merge = function(str, obj) {
	return matchdom(str, obj);
};
