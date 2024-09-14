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

const fs = require('node:fs/promises');

fs.mv ??= async function (oldPath, newPath) {
	try {
		await fs.rename(oldPath, newPath);
	} catch (err) {
		if (err.code == "EXDEV") {
			await fs.copyFile(oldPath, newPath);
			await fs.unlink(oldPath);
		} else {
			throw err;
		}
	}
};
