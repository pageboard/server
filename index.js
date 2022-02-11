const Pageboard = require("./lib/pageboard");
const app = new Pageboard();
const opts = app.opts;

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
if (opts._.length == 1) {
	console.info = function() {};
}

console.info(`server:\t${app.version}`);

(async () => {
	await app.init();
	if (opts._.length > 1) {
		console.error("Cannot process arguments", opts._);
		process.exit(1);
	}
	if (!opts.cli) {
		return app.start();
	}

	const command = opts._[0];
	if (opts.help) {
		console.info("\n", command);
		console.info(app.help(command));
		process.exit(0);
	}

	if (opts.data != null) opts.data = coercions(opts.data);
	if (opts.data !== undefined && typeof opts.data.data == "string") {
		try {
			opts.data.data = JSON.parse(opts.data.data);
		} catch(ex) {
			console.error(ex);
		}
	}
	const req = {};
	if (opts.site) {
		req.site = await app.install(await app.run('site.get', {}, { id: opts.site }));
	}

	const results = await app.run(command, req, opts.data);
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
