const BearerAgent = require('./src/agent');

module.exports = class PrintModule {
	static name = 'print';
	static priority = 100;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	// snippet using cups http backend https://gist.github.com/vodolaz095/5325917

	//

	async init() {
		this.Printer = (await import('cups-printer')).Printer;
		// TODO use another module that can send options with lp.
		// or do our own module
	}


	async local(req, { printer, path }) {
		const inst = await this.Printer.find(x => {
			return x.name.toLowerCase().includes(printer.toLowerCase());
		});
		if (!inst) throw new HttpError.NotFound("Missing printer");
		return inst.print(path);
	}
	static local = {
		title: 'Local print',
		required: ['path', 'printer'],
		$lock: true,
		properties: {
			path: {
				title: 'Path',
				type: 'string',
				format: 'pathname'
			},
			printer: {
				title: 'Printer',
				type: 'string',
				format: 'singleline'
			}
		}
	};

	async remote(req, { printer, path }) {
		const { expresta: conf } = this.opts;
		if (!conf) throw new HttpError.NotFound("No remote printer");
		const agent = new BearerAgent(conf.url);

		agent.bearer = (await agent.fetch("/login", "post", {
			email: conf.email,
			password: conf.password
		})).token;

		const products = await agent.fetch("/data/products");
		console.log(products);
	}
	static remote = {
		title: 'Remote print',
		properties: {
			provider: {
				title: 'Provider',
				description: 'Choose a supported provider'
			},
			path: {
				title: 'Path',
				type: 'string',
				format: 'pathname'
			}
		}
	};
};

