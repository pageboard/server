module.exports = translateJSON;

function translateJSON(keys, obj, dict) {
	if (!obj) return;
	Object.entries(obj).forEach(([key, val]) => {
		if (val == null) return;
		if (typeof val == "string") {
			if (keys.includes(key)) obj[key] = translate(val, dict);
		} else if (Array.isArray(val)) {
			val.forEach(val => translateJSON(keys, val, dict));
		} else if (typeof val == "object") {
			translateJSON(keys, val, dict);
		}
	});
}

function translate(str, dict) {
	const src = str.trim();
	const dst = dict[src];
	if (dst) {
		if (src.length != str.length) return str.replace(src, dst);
		else return dst;
	} else {
		return str;
	}
}
