Object.isEmpty = function (obj) {
	if (obj == null) return true;
	if (Array.isArray(obj)) return obj.length === 0;
	for (const key in obj) {
		if (Object.prototype.hasOwnProperty.call(obj, key)) {
			return false;
		}
	}
	return JSON.stringify(obj) === JSON.stringify({});
};

if (!RegExp.escape) {
	// https://github.com/tc39/proposal-regex-escaping/blob/main/polyfill.js
	RegExp.escape = function (s) {
		return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
	};
}
