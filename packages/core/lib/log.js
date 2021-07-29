const debug = require('debug');

class DebugProxy {
	constructor(root) {
		this.root = root;
	}
	get(obj, key) {
		let logger = Reflect.get(obj, key);

		if (!logger) {
			const flag = `${this.root}:${key}`;
			logger = debug(flag);
			Reflect.set(obj, key, logger);
		}
		return logger;
	}
}

module.exports = function(root) {
	return new Proxy({}, new DebugProxy(root));
};

