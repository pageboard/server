#!/usr/bin/env node

var http = require('http');

var pkgOpt = {};
if (process.env.APPNAME) pkgOpt.name = process.env.APPNAME;

if (process.argv.length > 2 && process.argv[2].startsWith('--') == false) {
	for (var i=3; i < process.argv.length; i++) {
		process.argv[i] = '--data.' + process.argv[i];
	}
}

var pageboard = require(__dirname);

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
	server.listen(All.opt.core.listen);

	process.title = All.opt.name;
	console.info(`Listening on port ${All.opt.core.listen}`);
}).catch(function(err) {
	console.error(err);
});

