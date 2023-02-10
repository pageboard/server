const { nestie } = require.lazy('nestie');
const { flattie } = require.lazy('flattie');
const dget = require.lazy('dlv');
const { Matchdom, TextPlugin } = require('./matchdom');
const getSlug = require.lazy('speakingurl');

const md = new Matchdom(TextPlugin, {
	types: {
		as: {
			slug: (ctx, str) => getSlug(str, { custom: { "_": "-" } })
		}
	}
});

exports.fuse = (obj, data, scope) => {
	return md.merge(obj, data, scope);
};

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
	let hit;
	const md = new Matchdom(TextPlugin, {
		hooks: {
			afterAll(ctx, val) {
				hit = val !== undefined;
			}
		}
	});

	for (const [key, val] of Object.entries(flatExpr)) {
		if (!val || typeof val != "string") continue;
		obj.$default = dget(data, key);
		const fused = md.merge(val, obj);
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
