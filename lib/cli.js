const Pageboard = require("./pageboard");
const { unflatten } = require('./utils');

if (!process.env.HOME) {
	throw new Error("Missing HOME environment variable");
}

(async () => {
	const {
		help,
		site,
		cli,
		command,
		opts = {},
		data = {}
	} = parseArgs(process.argv.slice(2));

	const info = console.info;
	if (cli) {
		opts.cli = true;
		console.info = () => { };
	}

	const app = await Pageboard.create(opts);

	if (help) {
		if (command) info.call(console, "\n", command);
		info.call(console, app.api.help(command));
		process.exit(0);
	}
	if (!command) {
		console.info(`server:\t${app.version}`);
		return app.start();
	}

	const req = { res: {} };
	app.domains.extendRequest(req, app);
	if (site) {
		req.site = await app.install(
			await req.run('site.get', {
				id: site
			})
		);
	}

	const results = await req.run(command, data);
	// eslint-disable-next-line no-console
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
	const opts = {};
	const data = {};
	const ret = { cli: true };
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
				ret.help = true;
				return ret;
			} else {
				data[key] = val;
			}
		} else if (ret.command) {
			console.error("Expected <options> <command> <data>");
			ret.help = true;
			return ret;
		} else {
			ret.command = key;
		}
	}
	if (typeof opts.data == "string") {
		try {
			Object.assign(data, JSON.parse(opts.data));
		} catch (ex) {
			console.error(ex);
		}
	}
	ret.opts = unflatten(opts);
	ret.data = unflatten(data);
	if (!ret.command) ret.cli = false;
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
