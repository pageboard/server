// const { nestie } = require.lazy('nestie');
const { flattie } = require.lazy('flattie');
const dget = require.lazy('dlv');
const getSlug = require.lazy('speakingurl');
const { access } = require('node:fs/promises');

let sharedMd;

exports.init = async () => {
	const {
		Matchdom, TextPlugin, JsonPlugin, StringPlugin, ArrayPlugin, OpsPlugin, NumPlugin, DatePlugin, RepeatPlugin, UrlPlugin
	} = await import('matchdom');
	sharedMd = new Matchdom(
		TextPlugin,
		StringPlugin,
		JsonPlugin,
		ArrayPlugin,
		OpsPlugin,
		NumPlugin,
		DatePlugin,
		UrlPlugin,
		RepeatPlugin,
		{
			debug: true,
			hooks: {
				before: {
					get(ctx, val, [path]) {
						if (path[0]?.startsWith('$') && ctx.$data == null) {
							ctx.$data = ctx.data;
							ctx.data = ctx.scope;
						}
					}
				},
				after: {
					get(ctx) {
						if (ctx.$data != null) {
							ctx.data = ctx.$data;
							ctx.$data = null;
						}
					}
				}
			},
			formats: {
				as: {
					slug: (ctx, str) => getSlug(str, { custom: { "_": "-" } })
				}
			}
		}
	);
};

exports.dget = dget;
exports.dset = dset;

exports.mergeRecursive = require.lazy('lodash.merge');

exports.unflatten = function(query) {
	return nestie(query) ?? {};
};

exports.flatten = function (obj) {
	return flattie(obj);
};

exports.mergeExpressions = function (data, flats, scope) {
	if (!flats) return data;
	const template = nestie(flats);
	if (!template) return data;
	return sharedMd.merge(template, data, scope) || {};
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
