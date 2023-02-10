#!/usr/bin/node

const Pageboard = require("../src/pageboard");

if (!process.env.HOME) {
	throw new Error("Missing HOME environment variable");
}

(async () => {
	const {
		help,
		command,
		opts = {},
		data = {}
	} = Pageboard.parse(process.argv.slice(2));

	if (!opts.server) opts.server = {};
	opts.server.start = !command;
	if (opts.verbose === undefined) opts.verbose = !command;

	const { site } = opts;
	delete opts.site;

	const app = new Pageboard(opts);
	await app.init();

	if (help) {
		if (command) console.info("\n", command);
		console.info(app.api.help(command));
		process.exit(0);
	} else if (!command) {
		return app;
	}
	try {
		const results = await app.run(command, data, site);
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
