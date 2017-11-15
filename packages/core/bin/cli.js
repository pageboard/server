#!/usr/bin/env node

var http = require('http');

var pageboard = require('../');

var pkgOpt = {};
if (process.env.APPNAME) pkgOpt.name = process.env.APPNAME;
var config = pageboard.config(pkgOpt);

console.info(`${config.name} ${config.version}`);

pageboard.init(config).then(function(All) {
	var p = Promise.resolve();
	var commands = 0;
	All.opt._.forEach(function(str) {
		var tokens = str.split('.');
		var token, obj = All;
		while (obj && (token = tokens.shift())) {
			obj = obj[token];
		}
		if (typeof obj != "function") return;
		commands++;
		p = p.then(function() {
			if (config.data) {
				console.info(`Run ${str}(${JSON.stringify(config.data, null, "  ")})`);
				return obj(config.data);
			} else {
				console.info(`Run ${str}`);
				return obj();
			}
		}).then(function(data) {
			console.info(`Done ${str}: ${JSON.stringify(data, null, "  ")}`);
		});
	});
	if (commands) {
		return p.then(function() {
			console.info(`Processed ${commands} commands, exiting...`);
			process.exit();
		});
	}

	var server = http.createServer(All.app);
	server.listen(All.opt.listen);

	process.title = All.opt.name;
	console.info(`http://localhost:${All.opt.listen}`);
}).catch(function(err) {
	console.error(err);
});

