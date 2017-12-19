#!/usr/bin/env node

var http = require('http');

var pageboard = require('../');

var pkgOpt = {};
if (process.env.APPNAME) pkgOpt.name = process.env.APPNAME;
var config = pageboard.config(pkgOpt);

console.info(`${config.name} ${config.version}`);

pageboard.init(config).then(function(All) {
	var p = Promise.resolve();
	if (All.opt._.length > 1) {
		console.error("Cannot process arguments", All.opt._);
		process.exit(1);
	}
	if (All.opt._.length == 1) {
		var command = All.opt._[0];
		return All.run(command, config.data).catch(function(err) {
			console.error(err.toString());
			process.exit(1);
		}).then(function(results) {
			console.log(JSON.stringify(results, null, ' '));
			console.info(`${command} done.`);
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

