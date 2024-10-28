const Path = require('node:path');

module.exports = class CoreModule {
	static priority = Infinity;
	static plugins = [
		'domains', 'install', 'log'
	].map(name => Path.join(__dirname, 'services', name));

	constructor(app) {
		this.app = app;
	}
};
