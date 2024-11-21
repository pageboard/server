#!/usr/bin/node
Error.stackTraceLimit = 100;
const Pageboard = require("../src/pageboard");

if (!process.env.HOME) {
	throw new Error("Missing HOME environment variable");
}

(async () => {
	const args = Pageboard.parse(process.argv.slice(2));
	const {
		opts = {},
		data = {}
	} = args;
	let { command } = args;
	const { site, grant, help } = opts;
	delete opts.site;
	delete opts.grant;
	delete opts.help;
	if (!opts.server) opts.server = {};
	opts.cli = command || help;
	if (opts.verbose === undefined && !help) opts.verbose = !command;

	const app = new Pageboard(opts);
	await app.init();

	if (help) {
		data.command = command;
		command = 'help.command';
	}
	if (!command) {
		return app;
	}
	try {
		const results = await app.run(command, data, { site, grant });
		// eslint-disable-next-line no-console
		console.log(
			typeof results == "string"
				? results
				: JSON.stringify(results, null, ' ')
		);
		process.exit();
	} catch (err) {
		console.error(err.statusCode ? err.name + ': ' + err.message : err);
		if (err.content) console.error(err.content);
		process.exit(1);
	}
})();
