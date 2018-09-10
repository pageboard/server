var matchdom = require('matchdom');
var flat = require('flat');


exports.unflatten = function(query) {
	return flat.unflatten(query, {
		object: true,
		maxDepth: 10
	});
};

exports.mergeParameters = mergeParameters;

function mergeParameters(params, obj) {
	if (params) Object.keys(params).forEach(function(key) {
		var val = params[key];
		if (typeof val == "string") {
			var str = `[${val}|valcb]`;
			var nstr = matchdom(str, obj, {
				valcb: function(val, what) {
					var path = what.scope.path.slice();
					var last = path.pop();
					var parent = what.expr.get(what.data, path);
					delete parent[last];
					return val;
				}
			});
			if (nstr != str) params[key] = nstr;
		} else if (typeof val == "object") {
			mergeParameters(val, obj);
		}
	});
	else params = {};
	return params;
}

