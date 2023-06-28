const BearerAgent = require('./src/agent');
const { promisify } = require('node:util');
const fs = require('node:fs');
const Path = require('node:path');
const pipeline = promisify(require('node:stream').pipeline);
const mime = require.lazy('mime-types');

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
	}


	async local(req, { printer, url }) {
		const inst = await this.Printer.find(x => {
			return x.name.toLowerCase().includes(printer.toLowerCase());
		});
		if (!inst) throw new HttpError.NotFound("Missing printer");

		const path = await this.#download(req, url);
		const ret = await inst.print(path);
		return ret;
	}
	static local = {
		title: 'Local print',
		required: ['url', 'printer'],
		$lock: true,
		properties: {
			url: {
				title: 'URL',
				type: 'string',
				format: 'uri'
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

	async #download(req, url) {
		const controller = new AbortController();
		const toId = setTimeout(() => controller.abort(), 100000);
		const response = await fetch(url, {
			headers: {
				cookie: req.get('cookie')
			},
			signal: controller.signal
		});
		let path;
		try {
			clearTimeout(toId);
			if (!response.ok) {
				throw new HttpError.BadRequest(response.statusText);
			}
			const type = response.headers.get('Content-Type');
			if (!type) {
				throw new HttpError.BadParams("Cannot print file that has not Content-Type");
			}
			const ext = mime.extension(type);
			if (ext != "pdf") {
				throw new HttpError.BadParams("Cannot print non-pdf file");
			}
			path = Path.join(this.app.dirs.tmp, await req.Block.genId()) + "." + ext;
			await pipeline(response.body, fs.createWriteStream(path));
			return path;
		} catch (err) {
			try {
				controller.abort();
				if (path) await fs.promises.unlink(path);
			} catch {
				// pass
			}
			throw err;
		}
	}
};
