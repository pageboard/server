var matchdom = require('matchdom');
var flat = require('flat');


exports.unflatten = function(query) {
	return flat.unflatten(query, {
		object: true,
		maxDepth: 8
	});
};

exports.mergeParameters = mergeParameters;

function mergeParameters(params, obj) {
	// consumed obj parameters are removed from obj
	// this is useful for populating a block with matchdom expressions
	// that merge variables but remove them as they are merged.
	// it is avoidable, especially with the new template variables,
	// the block data could be properly scoped and not mixed with request parameters.
	var ret = Array.isArray(params) ? [] : {};
	Object.entries(params).forEach(function([key, val]) {
		if (typeof val == "string") {
			val = matchdom(val, obj, {'||': function(val, what) {
				var path = what.scope.path.slice();
				if (path[0] == "$query" || path[0] == "$body" || path[0] == "$response") {
					var last = path.pop();
					var parent = what.expr.get(what.data, path);
					if (parent == null) return;
					delete parent[last];
				}
				return val;
			}});
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


exports.merge = function(str, obj) {
	return matchdom(str, obj);
};
