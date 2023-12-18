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

	async elements() {
		const list = [];
		if (this.opts.local) list.push({
			const: 'local',
			title: 'Local'
		});
		if (this.opts.storage) list.push({
			const: 'storage',
			title: 'Storage'
		});
		if (this.opts.remote) list.push({
			const: 'remote',
			title: 'Remote'
		});
		const { print_job } = await import('./src/print_job.mjs');
		if (list.length == 0) print_job.properties.printer.anyOf = list;
		else console.info("print: disabled");
		return { print_job };
	}

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
				$ref: "/blocks#/definitions/print_job/properties/data/properties/printer"
			}
		}
	};

	async run(req, data) {
		const response = {};
		const { item: block } = await req.run('block.add', {
			// w/a remote#customer_reference limit
			id: await req.Block.genId(7),
			type: 'print_job',
			data: { ...data, response }
		});
		let job;
		if (data.printer == "remote") {
			job = this.#remoteJob;
		} else if (data.printer == "storage") {
			job = this.#storageJob;
		} else if (data.printer == "local") {
			job = this.#localJob;
		}
		await runJob(req, block, (req, block) => job.call(this, req, block));
		if (response.status != null && response.status != 200) {
			throw new HttpError[response.status](response.text);
		}
		return block;
	}

	static run = {
		title: 'Run print task',
		$action: 'write',
		$ref: "/blocks#/definitions/print_job/properties/data"
	};

	async #localJob(req, block) {
		const { url, lang, options, response } = block.data;
		const pdfUrl = req.call('page.format', {
			url, lang, ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', 'printer');

		const list = await cups.getPrinterNames();
		if (!list.find(name => name == this.opts.local)) {
			throw new HttpError.NotFound("Printer not found");
		}

		runJob(req, block, async () => {
			const { path } = await this.#download(req, pdfUrl, this.app.dirs.tmp);
			try {
				const ret = await cups.printFile(path, {
					printer: this.opts.local,
					printerOptions: options
				});
				if (ret.stdout) console.info(ret.stdout);
				response.status = 200;
			} finally {
				await fs.promises.unlink(path);
			}
		});
	}

	async #storageJob(req, block) {
		const { url, lang, response } = block.data;
		if (!this.opts.storage) {
			throw new HttpError.BadRequest("No storage printer");
		}
		const pdfUrl = req.call('page.format', {
			url, lang, ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', 'printer');
		runJob(req, block, async () => {
			await this.#download(req, pdfUrl, this.opts.storage);
			response.status = 200;
		});
	}

	async #remoteJob(req, block) {
		const { remote: conf } = this.opts;
		if (!conf) throw new HttpError.BadRequest("No remote printer");
		const agent = new BearerAgent(this.opts, conf.url);

		agent.bearer = (await agent.fetch("/login", "post", {
			email: conf.email,
			password: conf.password
		})).token;

		const { options, delivery, response } = block.data;

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

		const { item: pdf } = await req.run('block.find', {
			type: 'pdf',
			data: {
				url: new URL(block.data.url, req.site.$url).pathname,
				lang: block.data.lang
			}
		});
		if (!pdf) throw new HttpError.NotFound('Content PDF not found');
		const pdfUrl = req.call('page.format', {
			url: block.data.url,
			lang: block.data.lang,
			ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', 'printer');

		const printProduct = {
			pdf: pdfUrl,
			product_type_id: options.product,
			binding_id: options.binding,
			binding_placement: options.binding_placement,
			amount: 1,
			runlists: []
		};
		if (options.discount_code) {
			printProduct.discount_code = options.discount;
		}
		let coverPaper;
		if (options.cover.url) {
			const { item: coverPdf } = await req.run('block.find', {
				type: 'pdf',
				data: {
					url: new URL(options.cover.url, req.site.$url).pathname,
					lang: block.data.lang
				}
			});
			if (!coverPdf) throw new HttpError.NotFound('Cover PDF not found');
			coverPaper = coverPdf.data.paper;
			const coverUrl = req.call('page.format', {
				url: options.cover.url,
				lang: block.data.lang,
				ext: 'pdf'
			});
			coverUrl.searchParams.set('pdf', 'printer');

			printProduct.cover_pdf = coverUrl;
		}

		const products = [printProduct];
		if (options.additionalProduct) {
			products.push({
				product_type_id: options.additionalProduct,
				amount: 1
			});
		}

		// customs_clearance_by_customer_data: 1
		// documentation: "https://cdn.expresta.com/common/files/customs-sample-usa.pdf"
		const order = {
			customer_reference: block.id,
			delivery: {
				...delivery,
				courier: courier?.courier ?? "courier"
			},
			products
		};

		runJob(req, block, async () => {
			const clean = [];

			const pdfRun = await this.#downloadPublic(req, printProduct.pdf);
			clean.push(pdfRun.path);
			printProduct.pdf = pdfRun.href;

			const { paper } = pdf.data;

			if (printProduct.cover_pdf) {
				// spine api
				if (pdfRun.count) {
					const ret = await agent.fetch('/calculate-spine', "post", {
						data: {
							pages_count: pdfRun.count,
							sides: 2,
							content_paper_id: options.content.paper,
							cover_paper_id: options.cover.paper
						}
					});
					if (ret.status != 'ok') {
						throw new HttpError.BadRequest(ret.msg);
					}
					paper.fold ??= {};
					paper.fold.width = parseFloat(ret.spine_width);
					printProduct.cover_pdf.searchParams.set('foldWidth', paper.fold.width);
				} else {
					console.warn("Missing pdf page count");
				}
				const coverRun = await this.#downloadPublic(req, printProduct.cover_pdf);
				clean.push(coverRun.path);
				printProduct.cover_pdf = coverRun.href;
				printProduct.runlists.push({
					tag: "cover",
					sides: options.cover.sides,
					paper_id: options.cover.paper,
					separation_mode: "CMYK",
					fold_on: "axis_longer",
					bleed: coverPaper.trim
				});
			}
			const width = paper.width - (paper.trim ? 2 * paper.margin : 0);
			const height = paper.height - (paper.trim ? 2 * paper.margin : 0);
			printProduct.runlists.push({
				tag: "content",
				sides: 2,
				paper_id: options.content.paper,
				separation_mode: "CMYK",
				size_a: width.toFixed(2),
				size_b: height.toFixed(2),
				bleed: paper.trim
			});

			try {
				const ret = await agent.fetch(conf.order, "post", {
					data: order
				});
				if (ret.status != "ok") {
					throw new HttpError.BadRequest(ret.msg);
				}
				block.data.order = {
					id: ret.order_id,
					price: ret.total_price
				};
				response.status = 200;
			} finally {
				for (const file of clean) await fs.promises.unlink(file);
			}
		});
		return block;
	}

	async #downloadPublic(req, url) {
		const { site } = req;
		const pubDir = Path.join(this.app.dirs.publicCache, site.id);
		await fs.promises.mkdir(pubDir, {
			recursive: true
		});
		const { path, response } = await this.#download(req, url, pubDir);
		const href = (new URL("/.public/" + Path.basename(path), site.$url)).href;
		const count = response.headers.get('x-page-count');
		return { href, path, count };
	}

	async #download(req, url, to) {
		const controller = new AbortController();
		const toId = setTimeout(() => controller.abort(), 100000);
		const response = await fetch(new URL(url, req.site.$url), {
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
			path = Path.join(to, await req.Block.genId()) + "." + ext;
			await pipeline(response.body, fs.createWriteStream(path));
			return { path, response };
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

async function runJob(req, block, job) {
	const { response } = block.data;
	try {
		const result = await job(req, block);
		return result;
	} catch (ex) {
		response.status = ex.statusCode ?? 500;
		response.text = ex.message;
	} finally {
		await req.run('block.save', {
			id: block.id,
			type: block.type,
			data: block.data
		});
	}
}

