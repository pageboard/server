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

	async init() {
		const { withCache } = await import("ultrafetch");
		this.opts.fetch = withCache(fetch);
	}

	async list(req) {
		const list = await cups.getPrinterNames();
		if (this.opts.storage) {
			list.unshift('storage');
		}
		if (this.opts.remote) {
			list.unshift('remote');
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
		title: 'List printers',
		$action: 'read'
	};

	async options(req, { printer }) {
		const item = {
			type: 'schema',
			data: {
				title: 'Printer options schema',
				name: printer
			},
			properties: {}
		};
		const p = item.properties;
		if (printer == "storage" && this.opts[printer]) {
			// nothing
		} else if (printer == "remote" && this.opts[printer]) {
			const conf = this.opts[printer];
			const agent = new BearerAgent(this.opts, conf.url);

			agent.bearer = (await agent.fetch("/login", "post", {
				email: conf.email,
				password: conf.password
			})).token;

			const remap = list => list.map(item => {
				const obj = {
					const: item.id,
					title: item.name
				};
				if (item.description) obj.description = item.description;
				return obj;
			});

			p.product = remap(await agent.fetch("/data/products"));
			p.paper = remap(await agent.fetch("/data/papers"));
			p.fold = remap(await agent.fetch("/data/folds"));
			p.binding = remap(await agent.fetch("/data/bindings"));
			p.surfaceTreatment = remap(await agent.fetch("/data/surface-treatments"));
			p.courier = {
				title: 'Courier method',
				anyOf: [{
					const: 'standard', title: 'Standard'
				}, {
					const: 'express', title: 'Express'
				}]
			};
		} else {
			const optsList = await cups.getPrinterOptions(printer);
			item.properties = Object.fromEntries(optsList.map(po => {
				const obj = {
					enum: po.values
				};
				if (po.defaultValue) obj.default = po.defaultValue;
				return [
					po.name,
					obj
				];
			}));
		}
		return { item };
	}
	static options = {
		title: 'Get printer options',
		description: 'Returns options as JSON-schema',
		$action: 'read',
		required: ['printer'],
		properties: {
			printer: {
				title: 'Printer name',
				type: 'string',
				format: 'singleline'
			}
		}
	};

	async run(req, data) {
		const block = await req.run('block.add', { type: 'print', data });
		let job;
		if (data.printer == "remote") {
			job = this.#remoteJob(req, block);
		} else if (data.printer == "storage") {
			job = this.#storageJob(req, block);
		} else {
			job = this.#localJob(req, block);
		}
		await runJob(req, block, job);
		return block;
	}

	static run = {
		title: 'Run print task',
		$action: 'write',
		$ref: "/$elements/print"
	};

	async #localJob(req, print) {
		const { printer, url, options } = print.data;
		const list = await cups.getPrinterNames();
		if (!list.find(name => name == printer)) {
			throw new HttpError.NotFound("Printer not found");
		}

		runJob(req, print, async () => {
			const path = await this.#download(req, url);
			try {
				const ret = await cups.printFile(path, {
					printer,
					printerOptions: options
				});
				if (ret.stdout) console.info(ret.stdout);
			} finally {
				await fs.promises.unlink(path);
			}
		});
	}

	async #storageJob(req, print) {
		const { url } = print.data;
		if (!this.opts.storage) {
			throw new HttpError.BadRequest("No storage printer");
		}
		runJob(req, print, async () => {
			const path = await this.#download(req, url);
			await fs.promises.rename(path, Path.join(this.opts.storage, Path.basename(path)));
		});
	}

	async #remoteJob(req, print) {
		const { remote: conf } = this.opts;
		if (!conf) throw new HttpError.BadRequest("No remote printer");
		const agent = new BearerAgent(this.opts, conf.url);

		agent.bearer = (await agent.fetch("/login", "post", {
			email: conf.email,
			password: conf.password
		})).token;

		const { url, options, delivery } = print.data;

		const couriers = await agent.fetch(`/data/deliveries-by-courier/${delivery.iso_code}`);
		const courier = couriers.find(item => {
			if (delivery.courier == "express") {
				if (item.courier.includes("express")) {
					return item;
				}
			} else if (delivery.courier == "standard") {
				if (item.courier == "courier" || item.courier.includes("courier")) {
					return item;
				}
			}
		});

		const pdfUrl = new URL(url, req.site.url);
		// 1. find pdf item
		const { item: pdf } = await req.run('block.find', {
			type: 'pdf',
			data: {
				url: pdfUrl.pathname.replace(/\.pdf$/, '')
			}
		});
		if (!pdf) throw new HttpError.NotFound('PDF not found');
		pdfUrl.searchParams.set('pdf', 'printer');
		const pdfPaper = pdf.data.paper;
		const sizeA = convertLengthToMillimiters(pdfPaper.width) || 210;
		const sizeB = convertLengthToMillimiters(pdfPaper.height) || 297;
		const margin = convertLengthToMillimiters(pdfPaper.margin) || 0;
		if (margin > 0 && margin < 5) {
			throw new HttpError.BadRequest("Margin should be >= 5mm for bleed to work");
		}


		const printProduct = {
			product_type_id: options.product,
			binding_id: options.binding,
			binding_placement: options.binding_placement,
			amount: 1,
			runlists: []
		};
		if (options.cover.sides) {
			pdfUrl.searchParams.set('pages', (options.cover.sides + 1) + '-');
			const coverUrl = new URL(pdfUrl);
			coverUrl.searchParams.set('pages', '1-' + options.cover.sides);
			printProduct.cover_pdf = coverUrl.href;
			printProduct.runlists.push({
				tag: "cover",
				sides: options.cover.sides,
				paper_id: options.cover.paper,
				separation_mode: "CMYK",
				fold_on: "axis_longer"
			});
		}
		printProduct.pdf = pdfUrl.href;
		printProduct.runlists.push({
			tag: "content",
			sides: 2,
			paper_id: options.content.paper,
			separation_mode: "CMYK",
			size_a: sizeA.toFixed(2),
			size_b: sizeB.toFixed(2),
			bleed: !margin
		});

		const products = [printProduct];
		if (options.additionalProduct) {
			products.push({
				product_type_id: options.additionalProduct,
				amount: 1
			});
		}

		// https://api.expresta.com/api/v1/order/sandbox-create for testing orders

		const order = {
			customer_reference: print.id,
			customs_clearance_by_customer_data: 1,
			// documentation: "https://cdn.expresta.com/common/files/customs-sample-usa.pdf",
			delivery: {
				...delivery,
				courier: courier?.courier ?? "courier"
			},
			products
		};

		const ret = await agent.fetch("/order/sandbox-create", "post", { data: order });
		if (ret.status != "ok") {
			throw new HttpError.BadRequest(ret.msg);
		}
		print.data.order = {
			id: ret.order_id,
			price: ret.total_price
		};
		return print;
	}

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


function convertLengthToMillimiters(str = '') {
	const num = parseFloat(str);
	if (Number.isNaN(num)) return 0;
	const { groups: { unit } } = /\d+(?<unit>\w+)/.exec(str) ?? { groups: {} };
	if (unit == "cm") return num * 10;
	else if (unit == "mm") return num;
}

async function runJob(req, block, job) {
	const isPromise = job instanceof Promise;
	try {
		if (!isPromise) await job();
		else await job;
		block.data.status = 'done';
	} catch (ex) {
		block.data.status = 'error';
		if (isPromise) throw ex;
	} finally {
		await req.run('block.save', block);
	}
}
