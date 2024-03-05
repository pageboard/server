const fs = require('node:fs');
const Path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').exec);
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
		this.Agent = (await import('./src/agent.mjs')).BearerAgent;
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
		if (list.length > 0) print_job.properties.printer.anyOf = list;
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
			const agent = new this.Agent(this.opts, conf.url);

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
				$ref: "/elements#/definitions/print_job/properties/data/properties/printer"
			}
		}
	};

	async again(req, data) {
		const block = await req.run('block.get', data);
		const job = {
			remote: this.#remoteJob,
			storage: this.#storageJob,
			local: this.#localJob
		}[block.data.printer];

		await req.try(block, (req, block) => job.call(this, req, block));
		return block;
	}
	static again = {
		title: 'Rerun print task',
		$action: 'write',
		required: ['id'],
		properties: {
			id: {
				title: 'id',
				type: 'string',
				format: 'id'
			}
		}
	};

	async run(req, data) {
		const { item: block } = await req.run('block.add', {
			// w/a remote#customer_reference limited to 15 chars
			id: await req.Block.genId(7),
			type: 'print_job',
			data: { ...data, response: {} }
		});
		const job = {
			remote: this.#remoteJob,
			storage: this.#storageJob,
			local: this.#localJob
		}[block.data.printer];

		await req.try(block, (req, block) => job.call(this, req, block));
		return block;
	}

	static run = {
		title: 'Run print task',
		$action: 'write',
		$ref: "/elements#/definitions/print_job/properties/data"
	};

	async #localJob(req, block) {
		const { url, lang, options } = block.data;
		const pdfUrl = req.call('page.format', {
			url, lang, ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', 'printer');

		const list = await cups.getPrinterNames();
		if (!list.find(name => name == this.opts.local)) {
			throw new HttpError.NotFound("Printer not found");
		}

		req.postpone(() => req.try(block, async () => {
			const { path } = await req.run('prerender.save', {
				path: pdfUrl.pathname + pdfUrl.search
			});
			try {
				const ret = await cups.printFile(path, {
					printer: this.opts.local,
					printerOptions: options
				});
				if (ret.stdout) console.info(ret.stdout);
			} finally {
				await fs.promises.unlink(path);
			}
		}));
	}

	async #storageJob(req, block) {
		const { url, lang } = block.data;
		if (!this.opts.storage) {
			throw new HttpError.BadRequest("No storage printer");
		}
		const pdfUrl = req.call('page.format', {
			url, lang, ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', 'printer');
		req.postpone(() => req.try(block, async () => {
			const { path } = await req.run('prerender.save', {
				path: pdfUrl.pathname + pdfUrl.search
			});
			const dest = Path.join(this.opts.storage, Path.basename(path));
			try {
				if (this.opts.storage.startsWith('/')) {
					await fs.promises.copyFile(path, dest);
				} else {
					await exec(`scp ${path} ${dest}`, {
						env: {
							SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK
						},
						shell: false,
						timeout: 120000
					});
				}
			} catch (ex) {
				throw new HttpError.InternalServerError(`Storage failure`);
			} finally {
				await fs.promises.unlink(path);
			}
		}));
	}

	async couriers(req, { iso_code }) {
		const { remote: conf } = this.opts;
		if (!conf) throw new HttpError.BadRequest("No remote printer");
		const agent = new this.Agent(this.opts, conf.url);

		agent.bearer = (await agent.fetch("/login", "post", {
			email: conf.email,
			password: conf.password
		})).token;

		return agent.fetch(`/data/deliveries-by-courier/${iso_code}`);
	}
	static couriers = {
		title: 'List couriers',
		$action: 'read',
		$global: true,
		required: ['iso_code'],
		properties: {
			iso_code: {
				$ref: "/elements#/definitions/print_job/properties/data/properties/delivery/properties/iso_code"
			}
		}
	};

	async #remoteJob(req, block) {
		const { remote: conf } = this.opts;
		if (!conf) throw new HttpError.BadRequest("No remote printer");
		const agent = new this.Agent(this.opts, conf.url);

		agent.bearer = (await agent.fetch("/login", "post", {
			email: conf.email,
			password: conf.password
		})).token;

		const { options, delivery } = block.data;
		const obj = { agent };

		const couriers = await agent.fetch(`/data/deliveries-by-courier/${delivery.iso_code}`);
		obj.courier = findCourier(couriers, delivery.courier)?.courier;
		if (!obj.courier) throw new HttpError.NotFound(
			`No courier found for "${delivery.courier}" to "${delivery.iso_code}"`
		);

		const { item: pdf } = await req.run('block.find', {
			type: 'pdf',
			data: {
				url: new URL(block.data.url, req.site.$url).pathname,
				lang: block.data.lang
			}
		});
		if (!pdf) throw new HttpError.NotFound('Content PDF not found');
		obj.pdf = pdf;
		if (options.cover.url) {
			const { item: coverPdf } = await req.run('block.find', {
				type: 'pdf',
				data: {
					url: new URL(options.cover.url, req.site.$url).pathname,
					lang: block.data.lang
				}
			});
			if (!coverPdf) throw new HttpError.NotFound('Cover PDF not found');
			obj.coverPdf = coverPdf;
		}

		req.postpone(
			() => req.try(block, (req, block) => this.#remoteCall(req, block, obj))
		);
		return block;
	}

	async #remoteCall(req, block, { agent, pdf, coverPdf, courier }) {
		const { options } = block.data;
		block.data.order = {};
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
		if (coverPdf) {
			const coverUrl = req.call('page.format', {
				url: options.cover.url,
				lang: block.data.lang,
				ext: 'pdf'
			});
			coverUrl.searchParams.set('pdf', 'printer');
			printProduct.cover_pdf = coverUrl;
		}
		if (options.discount_code) {
			printProduct.discount_code = options.discount;
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
				...block.data.delivery,
				courier
			},
			products
		};
		if (order.delivery.phone) {
			order.delivery.phone = order.delivery.phone.replaceAll(/[()-\s]+/g, '');
		}
		const clean = [];

		const pdfRun = await this.#publicPdf(
			req, printProduct.pdf, `${block.id}-content.pdf`
		);
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
			// TODO ensure coverPaper matches paper
			// const { paper: coverPaper } = coverPdf.data;
			const coverRun = await this.#publicPdf(
				req, printProduct.cover_pdf, `${block.id}-cover.pdf`
			);
			clean.push(coverRun.path);
			printProduct.cover_pdf = coverRun.href;
			printProduct.runlists.push({
				tag: "cover",
				sides: options.cover.sides,
				paper_id: options.cover.paper,
				separation_mode: "CMYK",
				fold_on: "axis_longer",
				bleed: options.bleed
			});
		}
		const width = paper.width - (options.bleed ? 2 * paper.margin : 0);
		const height = paper.height - (options.bleed ? 2 * paper.margin : 0);
		printProduct.runlists.push({
			tag: "content",
			sides: 2,
			paper_id: options.content.paper,
			separation_mode: "CMYK",
			size_a: width.toFixed(2),
			size_b: height.toFixed(2),
			bleed: options.bleed
		});

		try {
			const ret = await agent.fetch(req.opts.print.remote.order, "post", {
				data: order
			});
			if (ret.status != "ok") {
				console.info("got expresta response", ret);
				throw new HttpError.BadRequest(ret.msg);
			}
			block.data.order = {
				id: ret.order_id,
				price: ret.total_price
			};
		} finally {
			for (const file of clean) await fs.promises.unlink(file);
		}
	}

	async #publicPdf(req, url, name) {
		const { site } = req;
		const res = await req.run('prerender.save', {
			path: url.pathname + url.search
		});
		const pubDir = Path.join(this.app.dirs.publicCache, site.id);
		await fs.promises.mkdir(pubDir, {
			recursive: true
		});
		const destPath = Path.join(pubDir, name);
		await fs.promises.rename(res.path, destPath);

		const href = (new URL("/.public/" + name, site.$url)).href;
		const count = res.headers['x-page-count'];
		return { href, path: destPath, count };
	}
};


function findCourier(list, type) {
	const name = {
		express: 'courier',
		standard: 'letter'
	}[type];
	return list.find(item => item.courier.includes(name));
}
