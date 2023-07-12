const BearerAgent = require('./src/agent');
const fs = require('node:fs');
const Path = require('node:path');
const { pipeline } = require('node:stream/promises');
const mime = require.lazy('mime-types');
const cups = require('node-cups');

module.exports = class PrintModule {
	static name = 'print';
	static priority = 100;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async list(req) {
		const list = await cups.getPrinterNames();
		if (this.opts.hotfolder) {
			list.unshift({
				name: 'hotfolder'
			});
		}
		return {
			items: list.map(name => {
				return {
					type: 'printer',
					data: { name }
				};
			})
		};
	}
	static list = {
		title: 'Local printers',
		$action: 'read'
	};

	async options(req, { name }) {
		let list;
		if (name == "hotfolder" && this.opts.hotfolder) {
			list = [];
		} else {
			list = await cups.getPrinterOptions(name);
		}
		return {
			item: {
				type: 'schema',
				data: {
					title: 'Printer options schema',
					name,
					properties: Object.fromEntries(list.map(po => {
						const obj = {
							enum: po.values
						};
						if (po.defaultValue) obj.default = po.defaultValue;
						return [
							po.name,
							obj
						];
					}))
				}
			}
		};
	}
	static options = {
		title: 'Get printer specific options',
		description: 'PPD options as JSON-schema',
		$action: 'read',
		required: ['name'],
		properties: {
			name: {
				title: 'Printer name',
				type: 'string',
				format: 'singleline'
			}
		}
	};

	async local(req, { printer, url, options }) {
		const path = await this.#download(req, url);
		if (printer == "hotfolder" && this.opts.hotfolder) {
			await fs.promises.rename(path, Path.join(this.opts.hotfolder, Path.basename(path)));
			return {};
		} else {
			const ret = await cups.printFile(path, {
				printer,
				printerOptions: options
			});
			if (ret.stdout) console.info(ret.stdout);
			return {};
		}
	}
	static local = {
		title: 'Local print',
		$action: 'write',
		required: ['url', 'printer'],
		properties: {
			url: {
				title: 'PDF page',
				type: "string",
				format: "uri-reference",
				$filter: {
					name: 'helper',
					helper: {
						name: 'page',
						type: 'pdf'
					}
				},
				$helper: 'href'
			},
			printer: {
				title: 'Printer',
				type: 'string',
				format: 'singleline'
			},
			options: {
				title: 'Options',
				type: 'object',
				additionalProperties: { type: 'string' }
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
		const product = products.find(item => item.url == 'booklet-printing');
		if (!product) throw new HttpError.NotFound("No product with that name");
		return { workinprogress: true };
	}
	static remote = {
		title: 'Remote print',
		$action: 'write',
		properties: {
			provider: {
				title: 'Provider',
				description: 'Choose a supported provider',
				anyOf: [{ const: 'expresta', title: 'Expresta' }]
			},
			product: {
				title: 'Product',
				type: 'string',
				format: 'singleline'
			},
			paper: {
				title: 'Paper',
				type: 'string',
				format: 'singleline'
			},
			url: {
				title: 'URL',
				type: 'string',
				format: 'uri'
			}
		}
	};

	async #download(req, url) {
		const controller = new AbortController();
		const toId = setTimeout(() => controller.abort(), 100000);
		const response = await fetch(new URL(url, req.site.url), {
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
				throw new HttpError.BadRequest("Cannot print file that has not Content-Type");
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
