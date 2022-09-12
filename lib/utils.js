const { nestie } = require.lazy('nestie');
const { flattie } = require.lazy('flattie');
const dget = require.lazy('dlv');
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

exports.flatten = function (obj) {
	return flattie(obj);
};

exports.mergeExpressions = function mergeExpressions(data, expr, obj) {
	// only actually fused expressions in expr go into data
	const flatExpr = flattie(expr);
	obj = Object.assign(obj);

	for (const [key, val] of Object.entries(flatExpr)) {
		if (!val || typeof val != "string") continue;
		let hit = false;
		let opt = false;
		obj.$default = dget(data, key);
		const fused = matchdom(val, obj, {
			'||': val => {
				if (!opt) hit = true;
				return val;
			},
			opt: val => {
				if (val === undefined) opt = true;
				return val;
			}
		});
		if (hit) dset(data, key, fused);
	}
	return data;
};

// https://github.com/bgoscinski/dset
// MIT License © Luke Edwards
function dset(obj, keys, val) {
	keys.split && (keys = keys.split('.'));
	let i = 0;
	const l = keys.length;
	let t = obj;
	let x, k;
	while (i < l) {
		k = keys[i++];
		if (k === '__proto__' || k === 'constructor' || k === 'prototype') break;
		t = t[k] = (i === l) ? val : ((x = t[k]) && typeof (x) === typeof (keys)) ? x : (k = '+' + keys[i]) * 0 !== 0 || /\./.test(k) ? {} : [];
	}
}
