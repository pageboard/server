#!/usr/bin/env node

const pkgOpt = {};
if (process.env.APPNAME) pkgOpt.name = process.env.APPNAME;
if (!process.env.HOME) throw new Error("Missing HOME environment variable");

if (process.argv.length > 2) {
	let thenData = false;
	for (let i = 2; i < process.argv.length; i++) {
		if (process.argv[i].startsWith('--') == false) {
			// skip the first one, which is supposed to be the api command
			if (thenData) process.argv[i] = '--data.' + process.argv[i];
			thenData = true;
		}
	}
}

const pageboard = require(__dirname);

const config = pageboard.config(pkgOpt);
const title = `${config.name}@${config.version}`;
process.title = title;

if (config._.length == 1) {
	console.info = function() {};
}

console.info(`server:\t${config.version}`);

pageboard.init(config).catch((err) => {
	console.error(err);
	process.exit(1);
}).then((All) => {
	if (All.opt._.length > 1) {
		console.error("Cannot process arguments", All.opt._);
		process.exit(1);
	}
	if (!All.opt.cli) {
		return pageboard.start(All);
	}

	const command = All.opt._[0];
	if (All.opt.help) {
		console.info("\n", command);
		console.info(All.help(command));
		process.exit(0);
	}

	const args = [command];
	if (config.data != null) config.data = coercions(config.data);
	return Promise.resolve().then(() => {
		if (config.data !== undefined && typeof config.data.data == "string") {
			try {
				config.data.data = JSON.parse(config.data.data);
			} catch(ex) {
				console.error(ex);
			}
		}
		if (All.opt.site) {
			return All.run('site.get', {}, { id: All.opt.site }).then((site) => {
				return All.install(site).then((site) => {
					args.push({ site });
					args.push(config.data || {});
				});
			});
		} else {
			args.push({});
			args.push(config.data || {});
		}
	}).then(() => {
		return All.run.apply(All, args).then((results) => {
			// eslint-disable-next-line no-console
			console.log(
				typeof results == "string"
					? results
					: JSON.stringify(results, null, ' ')
			);
			process.exit();
		});
	});
}).catch((err) => {
	console.error(err.message || err);
	process.exit(1);
});

function coercions(data) {
	let obj = {};
	let keyString;
	Object.entries(data).forEach(([key, val]) => {
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
