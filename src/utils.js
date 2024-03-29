// const { nestie } = require.lazy('nestie');
const { flattie } = require.lazy('flattie');
const dget = require.lazy('dlv');
const getSlug = require.lazy('speakingurl');
const { access } = require('node:fs/promises');

let sharedMd;

exports.init = async () => {
	const {
		Matchdom, TextPlugin, ArrayPlugin, OpsPlugin, NumPlugin, DatePlugin, RepeatPlugin
	} = await import('matchdom');
	sharedMd = new Matchdom(
		TextPlugin,
		ArrayPlugin,
		OpsPlugin,
		NumPlugin,
		DatePlugin,
		RepeatPlugin,
		{
			formats: {
				as: {
					slug: (ctx, str) => getSlug(str, { custom: { "_": "-" } }),
					query: (ctx, obj) => {
						if (!obj) return obj;
						const q = new URLSearchParams();
						for (const [key, val] of Object.entries(obj)) {
							if (Array.isArray(val)) for (const item of val) q.append(key, item);
							else if (val !== null) q.append(key, val);
						}
						const ser = q.toString();
						return ser ? `?${ser}` : '';
					}
				}
			}
		}
	);
};

exports.dget = dget;
exports.dset = dset;

exports.fuse = (obj, data, scope) => {
	return sharedMd.merge(obj, data, scope);
};

exports.mergeRecursive = require.lazy('lodash.merge');

exports.unflatten = function(query) {
	return nestie(query) ?? {};
};

exports.flatten = function (obj) {
	return flattie(obj);
};

exports.mergeExpressions = function mergeExpressions(data, expr, obj) {
	// only actually fused expressions in expr go into data
	const flatExpr = flattie(expr);
	let miss = false;
	const md = sharedMd.copy().extend({
		hooks: {
			afterAll(ctx, val) {
				if (val === undefined) miss = true;
				return val;
			}
		}
	});

	for (const [key, val] of Object.entries(flatExpr)) {
		if (!val || typeof val != "string") continue;
		const copy = structuredClone(obj);
		copy.$default = dget(data, key);
		miss = false;
		const fused = md.merge(val, copy);
		if (!miss && fused !== undefined) dset(data, key, fused);
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

function empty(key) {
	if (key == null || key === "") return {};
	key = Number(key);
	return key === key ? [] : {};
}

function nestie(input, glue) {
	glue = glue || '.';
	let arr, tmp, output;
	let i = 0, k, key;

	for (k in input) {
		tmp = output; // reset
		arr = k.split(glue);

		for (i = 0; i < arr.length;) {
			key = arr[i++];

			if (tmp == null) {
				tmp = empty(key);
				output = output || tmp;
			}

			if (key == '__proto__' || key == 'constructor' || key == 'prototype') break;

			if (i < arr.length) {
				if (key in tmp) {
					tmp = tmp[key];
				} else {
					tmp = tmp[key] = empty(arr[i]);
				}
			} else {
				tmp[key] = input[k];
			}
		}
	}

	return output;
}

exports.nestie = nestie;


exports.exists = async function(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};
