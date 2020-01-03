const debug = require('debug');

class DebugProxy {
	constructor(root) {
		this.root = root;
	}
	get(obj, key) {
		var logger = Reflect.get(obj, key);

		if (!logger) {
			let flag = `${this.root}:${key}`;
			logger = debug(flag);
			Reflect.set(obj, key, logger);
		}
		return logger;
	}
}

module.exports = function(root) {
	return new Proxy({}, new DebugProxy(root));
};

