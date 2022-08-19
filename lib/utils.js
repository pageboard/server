const { nestie } = require.lazy('nestie');
const matchdom = require('matchdom');
const getSlug = require.lazy('speakingurl');

matchdom.filters.slug = str => {
	return getSlug(str, {
		custom: {
			"_": "-"
		}
	});
};

exports.fuse = matchdom;
exports.mergeRecursive = require.lazy('lodash.merge');

exports.unflatten = function(query) {
	return nestie(query);
};

exports.mergeParameters = function mergeParameters(params, obj) {
	const ret = Array.isArray(params) ? [] : {};
	Object.entries(params).forEach(([key, val]) => {
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
};

exports.mergeExpressions = function mergeExpressions(data, expr) {
	if (data == null) return expr;
	const copy = Array.isArray(data) ? [...data] : { ...data };
	if (expr != null) Object.entries(expr).forEach(([key, val]) => {
		let sval = copy[key];
		if (val == null) return;
		else if (typeof val == "object") {
			if (Array.isArray(val)) {
				if (sval == null) sval = [];
				else if (!Array.isArray(sval)) sval = [sval];
			} else if (sval == null) {
				sval = {};
			}
			copy[key] = mergeExpressions(sval, val);
		} else {
			copy[key] = val;
		}
	});
	return copy;
};

