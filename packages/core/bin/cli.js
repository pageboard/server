#!/usr/bin/env node

var http = require('http');

var pageboard = require('../');

var config = pageboard.config();

console.info(`${config.name} ${config.version}`);

pageboard.init(config).then(function(app) {
	if (config._.length > 0) {
		console.log("All commands done\nExit");
		process.exit();
	}
	var server = http.createServer(app);
	server.listen(config.listen);

	process.title = config.appname;
	console.info(`http://localhost:${config.listen}`);
}).catch(function(err) {
	console.error(err);
});

