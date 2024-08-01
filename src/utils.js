const dget = require.lazy('dlv');
const getSlug = require.lazy('speakingurl');
const mergeWith = require.lazy('lodash.mergewith');
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
				},
				afterAll(ctx, val) {
					if (ctx.expr.optional && val == null) {
						// JSON object model - assume that we don't want undefined key/value pairs
						ctx.filter(val, 'fail', '*');
					}
					return val;
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

exports.mergeRecursive = (...args) => {
	return mergeWith(...args, (dst, src) => {
		if (Array.isArray(dst) && Array.isArray(src)) {
			const ret = new Set(mergeWith(dst, src));
			return Array.from(ret);
		}
	});
};

exports.unflatten = function(query) {
	return nestie(query) ?? {};
};

exports.flatten = function (obj, opts) {
	return flattie(obj, opts);
};

exports.mergeExpressions = function (data, template, scope) {
	if (!template) return data;
	return sharedMd.merge(template, data, structuredClone(scope)) || {};
};

exports.merge = function (template, data) {
	return sharedMd.merge(template, data);
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

function iterFlat(output, nullish, sep, val, key, array) {
	let k;
	const pfx = key ? (key + sep) : key;
	if (val === undefined) {
		// pass
	} else if (val === null) {
		if (nullish) output[key] = val;
	} else if (typeof val != 'object') {
		output[key] = val;
	} else if (Array.isArray(val)) {
		if (array) output[key] = val;
		else for (k = 0; k < val.length; k++) {
			iterFlat(output, nullish, sep, val[k], pfx + k, array);
		}
	} else {
		for (k in val) {
			iterFlat(output, nullish, sep, val[k], pfx + k, array);
		}
	}
}

function flattie(input, { glue, nulls, array }) {
	const output = {};
	if (typeof input == 'object') {
		iterFlat(output, Boolean(nulls), glue || '.', input, '', array);
	}
	return output;
}

exports.exists = async function(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};
