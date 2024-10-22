module.exports = translateJSON;

function translateJSON(keys, obj, dict) {
	if (!obj) return;
	for (const [key, val] of Object.entries(obj)) {
		if (val == null) continue;
		if (typeof val == "string") {
			if (keys.includes(key)) obj[key] = translate(val, dict);
		} else if (Array.isArray(val)) {
			for (const str of val) {
				translateJSON(keys, str, dict);
			}
		} else if (typeof val == "object") {
			translateJSON(keys, val, dict);
		}
	}
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
