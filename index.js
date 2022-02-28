const minimist = require('minimist');
const toml = require('toml');
const xdg = require('xdg-basedir');
const Path = require('path');
const { readFile } = require('fs').promises;
const Pageboard = require("./lib/pageboard");

if (!process.env.HOME) {
	throw new Error("Missing HOME environment variable");
}
const dir = __dirname;

const {
	name,
	version
} = require(Path.join(dir, 'package.json'));

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

(async () => {
	const args = minimist(process.argv.slice(2));
	args.name = name;
	args.version = version.split('.').slice(0, 2).join('.');
	args.dirs = Object.assign({}, args.dirs, {
		config: Path.join(xdg.config, name),
		cache: Path.join(xdg.cache, name),
		data: Path.join(xdg.data, name),
		tmp: Path.join(xdg.data, '../tmp', name)
	});

	if (!args.config) {
		args.config = Path.join(args.dirs.config, 'config');
	}
	const data = coercions(args.data);
	if (data) delete args.data;

	Object.assign(
		args,
		toml.parse(await readFile(args.config)),
		args
	);
	args.dir = dir;

	const [command, unknown] = args._;
	delete args._;

	if (unknown !== undefined) {
		console.error("Cannot process arguments", args._);
		process.exit(1);
	}
	const app = new Pageboard(args);
	const { opts } = app;
	await app.init();

	if (!command) {
		console.info(`server:\t${app.version}`);
		return app.start();
	}
	opts.cli = true;
	if (args.help) {
		console.info("\n", command);
		console.info(app.help(command));
		process.exit(0);
	}
	console.info = () => { };

	if (data !== undefined && typeof data.data == "string") {
		try {
			data.data = JSON.parse(data.data);
		} catch(ex) {
			console.error(ex);
		}
	}
	const req = {};
	if (opts.site) {
		req.site = await app.install(
			await app.run('site.get', req, {
				id: opts.site
			})
		);
	}

	const results = await app.run(command, req, data);
	console.log(
		typeof results == "string"
			? results
			: JSON.stringify(results, null, ' ')
	);
	process.exit();
})().catch((err) => {
	console.error(err.statusCode ? err.name + ': ' + err.message : err);
	process.exit(1);
});

function coercions(data) {
	if (data == null) return data;
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
