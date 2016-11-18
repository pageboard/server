#!/usr/bin/env node

var http = require('http');

var pageboard = require('../');

var config = pageboard.config();

console.info(`${config.name} ${config.version}`);

var app = pageboard.init(config);

var server = http.createServer(app);
server.listen(config.listen);

process.title = config.appname;
process.on('uncaughtException', function(err) {
	console.error(err);
});
console.info(`http://localhost:${config.listen}`);

