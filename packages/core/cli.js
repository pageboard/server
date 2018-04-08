#!/usr/bin/env node

var pkgOpt = {};
if (process.env.APPNAME) pkgOpt.name = process.env.APPNAME;

if (process.argv.length > 2) {
	var thenData = false;
	for (var i=2; i < process.argv.length; i++) {
		if (thenData) process.argv[i] = '--data.' + process.argv[i];
		if (process.argv[i].startsWith('--') == false) thenData = true;
	}
}

var pageboard = require(__dirname);

var config = pageboard.config(pkgOpt);
var title = `${config.name} ${config.version}`;
process.title = title;

console.info(title);

pageboard.init(config).then(function(All) {
	var p = Promise.resolve();
	var site = All.opt.site;

	if (All.opt._.length > 1) {
		console.error("Cannot process arguments", All.opt._);
		process.exit(1);
	}
	if (All.opt._.length == 1) {
		var command = All.opt._[0];
		var args = [command];
		return Promise.resolve().then(function() {
			if (All.opt.site) {
				return All.run('site.get', {id: All.opt.site}).then(function(site) {
					return All.install(site).then(function(site) {
						args.push(site);
						args.push(config.data);
					});
				});
			} else {
				args.push(config.data);
			}
		}).then(function() {
			return All.run.apply(All, args).catch(function(err) {
				console.error(err);
				process.exit(1);
			});
		}).then(function(results) {
			console.log(JSON.stringify(results, null, ' '));
			console.info(`${command} done.`);
			process.exit();
		});
	} else {
		return pageboard.start(All);
	}
}).catch(function(err) {
	console.error(err);
});

