#!/usr/bin/env node

var pkgOpt = {};
if (process.env.APPNAME) pkgOpt.name = process.env.APPNAME;
if (!process.env.HOME) throw new Error("Missing HOME environment variable");

if (process.argv.length > 2) {
	var thenData = false;
	for (var i=2; i < process.argv.length; i++) {
		if (process.argv[i].startsWith('--') == false) {
			// skip the first one, which is supposed to be the api command
			if (thenData) process.argv[i] = '--data.' + process.argv[i];
			thenData = true;
		}
	}
}

var pageboard = require(__dirname);

var config = pageboard.config(pkgOpt);
var title = `${config.name}@${config.version}`;
process.title = title;

if (config._.length == 1) {
	console.info = function() {};
}

console.info(`server:\t${config.version}`);

pageboard.init(config).catch(function(err) {
	console.error(err);
	process.exit(1);
}).then(function(All) {
	if (All.opt._.length > 1) {
		console.error("Cannot process arguments", All.opt._);
		process.exit(1);
	}
	if (!All.opt.cli) {
		return pageboard.start(All);
	}

	var command = All.opt._[0];
	if (All.opt.help) {
		console.log("\n", command);
		console.log(All.help(command));
		process.exit(0);
	}

	var args = [command];
	if (config.data != null) config.data = coercions(config.data);
	return Promise.resolve().then(function() {
		if (config.data !== undefined && typeof config.data.data == "string") {
			try {
				config.data.data = JSON.parse(config.data.data);
			} catch(ex) {
				console.error(ex);
			}
		}
		if (All.opt.site) {
			return All.site.get({}, {id: All.opt.site}).select('_id').then(function(site) {
				return All.install(site).then(function(site) {
					args.push({site});
					if (config.data !== undefined) args.push(config.data);
				});
			});
		} else {
			args.push({});
			if (config.data !== undefined) args.push(config.data);
		}
	}).then(function() {
		return All.run.apply(All, args).then(function(results) {
			if (typeof results == "string") console.log(results);
			else console.log(JSON.stringify(results, null, ' '));
			process.exit();
		});
	});
}).catch(function(err) {
	console.error(err.message || err);
	process.exit(1);
});

function coercions(data) {
	var obj = {};
	var keyString;
	Object.entries(data).forEach(function([key, val]) {
		if (parseInt(key) != key) keyString = true;
		else if (!keyString) keyString = false;
		if (val === "") {
			obj[key] = null;
		} else if (val != null && typeof val == "object") {
			obj[key] = coercions(val);
		} else {
			obj[key] = val;
		}
	});
	if (keyString === false) obj = Object.values(obj);
	return obj;
}
