var matchdom = require('matchdom');
var flat = require('flat');


exports.unflatten = function(query) {
	return flat.unflatten(query, {
		object: true,
		maxDepth: 10
	});
};

exports.mergeParameters = mergeParameters;

function mergeParameters(params, obj, ret) {
	// consumed obj parameters are removed from obj
	// this is useful for populating a block with matchdom expressions
	// that merge variables but remove them as they are merged.
	// it is avoidable, especially with the new template variables,
	// the block data could be properly scoped and not mixed with request parameters.
	if (!ret) ret = {};
	Object.keys(params).forEach(function(key) {
		var val = ret[key] = params[key];
		if (typeof val == "string") {
			ret[key] = matchdom(val, obj, {'||': function(val, what) {
				var path = what.scope.path.slice();
				if (path[0] == "$query" || path[0] == "$body" || path[0] == "$response") {
					var last = path.pop();
					var parent = what.expr.get(what.data, path);
					delete parent[last];
				}
				return val;
			}});
		} else if (typeof val == "object") {
			ret[key] = {};
			mergeParameters(val, obj, ret[key]);
		}
	});
	return ret;
}


exports.merge = function(str, obj) {
	return matchdom(str, obj);
};
