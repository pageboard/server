const { unflatten } = require('./utils');

exports.parse = function (args) {
	const opts = {};
	const data = {};
	const ret = { cli: true };
	for (const arg of args) {
		const { key, val } = parseArg(arg);
		if (ret.site === undefined) {
			if (key == "--site") {
				ret.site = val;
				continue;
			} else {
				ret.site = null;
			}
		}
		if (key.startsWith('--')) {
			opts[key.substring(2)] = val === undefined ? true : val;
		} else if (val !== undefined) {
			if (!ret.command) {
				console.error("Expected <options> <command> <data>");
				ret.help = true;
				return ret;
			} else {
				data[key] = val;
			}
		} else if (ret.command) {
			console.error("Expected <options> <command> <data>");
			ret.help = true;
			return ret;
		} else {
			ret.command = key;
		}
	}
	if (typeof opts.data == "string") {
		try {
			Object.assign(data, JSON.parse(opts.data));
		} catch (ex) {
			console.error(ex);
		}
	}
	ret.opts = unflatten(opts);
	ret.data = unflatten(data);
	return ret;
};

function parseArg(str) {
	const { key, val } = (
		/^(?<key>(?:--)?[a-z.]+)(?:=(?<val>.*))?$/.exec(str) || {
			groups: {}
		}
	).groups;
	return { key, val: val === "" ? null : val };
}
