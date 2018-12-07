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
	if (!ret) ret = {};
	Object.keys(params).forEach(function(key) {
		var val = ret[key] = params[key];
		if (typeof val == "string") {
			matchdom(`[${val}]`, obj, {'||': function(val, what) {
				var path = what.scope.path.slice();
				if (path[0] == "$query" || path[0] == "$body" || path[0] == "$response") {
					var last = path.pop();
					var parent = what.expr.get(what.data, path);
					delete parent[last];
					ret[key] = val;
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
