const toml = require('toml');
const xdg = require('xdg-basedir');
const Path = require('path');
const { readFile } = require('fs').promises;
const Pageboard = require("./lib/pageboard");
const { unflatten } = require('./lib/utils')

if (!process.env.HOME) {
	throw new Error("Missing HOME environment variable");
}
const dir = __dirname;

const {
	name,
	version
} = require(Path.join(dir, 'package.json'));

// command - <site> - param1=val1 param2=val2...


(async () => {
	const {
		command,
		opts = {},
		data = {}
	} = parseArgs(process.argv.slice(2));
	opts.name = name;
	opts.version = version.split('.').slice(0, 2).join('.');
	opts.dirs = Object.assign({}, opts.dirs, {
		config: Path.join(xdg.config, name),
		cache: Path.join(xdg.cache, name),
		data: Path.join(xdg.data, name),
		tmp: Path.join(xdg.data, '../tmp', name)
	});

	if (!opts.config) {
		opts.config = Path.join(opts.dirs.config, 'config');
	}

	Object.assign(
		opts,
		toml.parse(await readFile(opts.config)),
		opts
	);
	opts.dir = dir;
	const info = console.info;
	if (command || opts.help) {
		opts.cli = true;
		console.info = () => { };
	}

	const app = new Pageboard(opts);
	await app.init();

	if (opts.help) {
		if (command) info.call(console, "\n", command);
		info.call(console, app.api.help(command));
		process.exit(0);
	}
	if (!command) {
		console.info(`server:\t${app.version}`);
		return app.start();
	}

	if (typeof opts.data == "string") {
		try {
			Object.assign(data, JSON.parse(opts.data));
		} catch(ex) {
			console.error(ex);
		}
	}
	const req = {};
	req.run = (command, data) => {
		return app.run(req, command, data);
	};
	if (opts.site) {
		req.site = await app.install(
			await req.run('site.get', {
				id: opts.site
			})
		);
	}

	const results = await req.run(command, data);
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

function parseArgs(args) {
	if (args.length == 0) {
		return { cli: false };
	}
	const opts = {};
	const data = {};
	const ret = {};
	for (const arg of args) {
		const { key, val } = parseArg(arg);
		if (ret.site === undefined) {
			if (key == "--site") {
				ret.site = val;
				continue;
			} else {
				ret.site = null;
			}
		}
		if (key.startsWith('--')) {
			opts[key.substring(2)] = val === undefined ? true : val;
		} else if (val !== undefined) {
			if (!ret.command) {
				console.error("Expected <options> <command> <data>");
				return { help: true };
			} else {
				data[key] = val;
			}
		} else if (ret.command) {
			console.error("Expected <options> <command> <data>");
			return { help: true };
		} else {
			ret.command = key;
		}
	}
	ret.opts = unflatten(opts);
	ret.data = unflatten(data);
	return ret;
}

function parseArg(str) {
	const { key, val } = (
		/^(?<key>(?:--)?[a-z.]+)(?:=(?<val>.*))?$/.exec(str) || {
			groups: {}
		}
	).groups;
	return { key, val: val === "" ? null : val };
}
