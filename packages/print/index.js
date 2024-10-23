const fs = require('node:fs/promises');
const Path = require('node:path');
const cups = require('node-cups');
const TTLMap = require('./src/ttl-map');

module.exports = class PrintModule {
	static name = 'print';
	static priority = 100;

	#bearers = new TTLMap(60 * 60 * 24 * 1000); // bearers expire after a day

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async init() {
		this.Agent = (await import('./src/agent.mjs')).BearerAgent;
	}

	async elements(elements) {
		const properties = {};
		elements.site.properties.printers = {
			title: 'Printers',
			properties
		};
		const list = [];
		if (this.opts.offline) {
			list.push({
				const: 'offline',
				title: 'Offline'
			});
			properties.offline = {
				title: 'Offline',
				nullable: true,
				type: 'string',
				format: 'name'
			};
		}
		if (this.opts.online) {
			list.push({
				const: 'online',
				title: 'Online'
			});
			properties.online = {
				title: 'Online',
				nullable: true,
				type: 'boolean',
				default: false
			};
		}
		if (this.opts.remote) {
			list.push({
				const: 'remote',
				title: 'Remote'
			});
			properties.remote = {
				title: 'Remote',
				nullable: true,
				properties: {
					login: {
						title: 'login',
						type: 'string',
						format: 'singleline'
					},
					password: {
						title: 'password',
						type: 'string',
						format: 'singleline'
					}
				}
			};
		}
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
		const conf = this.opts[printer];
		if (!conf) return { item };
		const p = item.properties;
		if (printer == "offline" || printer == "online") {
			// nothing
		} else if (printer == "remote") {
			const agent = await this.#getAuthorizedAgent(req, {
				url: conf.url
			});

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
		} else if (printer == "printer") {
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
		title: 'Options',
		description: 'Returns options as JSON-schema',
		$action: 'read',
		required: ['printer'],
		properties: {
			printer: {
				$ref: "/elements#/definitions/print_job/properties/data/properties/printer"
			}
		}
	};

	async preview(req, data) {
		const block = await req.run('block.get', { id: data.id, type: 'print_job' });
		block.data.device = "screen";
		await this.#onlineJob(req, block);
		return block;
	}
	static preview = {
		title: 'Preview',
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

	async send(req, data) {
		const block = await req.run('block.get', {
			type: 'print_job',
			id: data.id
		});
		block.data.order = {
			status: 'accepted'
		};
		const job = {
			remote: this.#remoteJob,
			offline: this.#offlineJob,
			printer: this.#printerJob,
			online: this.#onlineJob
		}[block.data.printer];

		const ret = await req.try(block, (req, block) => job.call(this, req, block));
		return { ...ret, item: block };
	}
	static send = {
		title: 'Send',
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

	async #onlineJob(req, block) {
		const { url, lang, device } = block.data;
		const pdfUrl = req.call('page.format', {
			url, lang, ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', device);
		const pdfRun = req.call('statics.file', 'cache', `${block.id}.pdf`);
		req.finish(async () => req.try(
			block,
			(req, block) => this.#publicPdf(
				req, pdfUrl, pdfRun.path
			)
		));
		return { url: pdfRun.url };
	}

	async #printerJob(req, block) {
		const { url, lang, device, options } = block.data;
		const pdfUrl = req.call('page.format', {
			url, lang, ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', device);

		const list = await cups.getPrinterNames();
		if (!list.find(name => name == this.opts.local)) {
			throw new HttpError.NotFound("Printer not found");
		}
		req.finish(async () => req.try(
			block,
			async (req, block) => {
				const { path } = await req.run('prerender.save', {
					url: pdfUrl.pathname + pdfUrl.search
				});
				try {
					const ret = await cups.printFile(path, {
						printer: this.opts.local,
						printerOptions: options
					});
					if (ret.stdout) console.info(ret.stdout);
				} finally {
					await fs.unlink(path);
				}
			}
		));
	}

	async #offlineJob(req, block) {
		const { offline } = req.site.data.printers ?? {};
		const { basedir } = this.opts.offline ?? {};
		if (!offline || !basedir) throw new HttpError.BadRequest("No offline printer");
		const { url, lang, device } = block.data;
		const storePath = Path.join(basedir, offline);
		const pdfUrl = req.call('page.format', {
			url, lang, ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', device);
		req.finish(async () => req.try(block, async (req, block) => {
			const { path } = await req.run('prerender.save', {
				url: pdfUrl.pathname + pdfUrl.search
			});
			const dest = Path.join(storePath, block.id + '.pdf');
			try {
				await fs.copyFile(path, dest);
			} catch (ex) {
				console.error(ex);
				throw new HttpError.InternalServerError(`Offline job failure`);
			} finally {
				await fs.unlink(path);
			}
		}));
	}

	async couriers(req, { iso_code }) {
		const { remote: conf } = this.opts;
		if (!conf) throw new HttpError.BadRequest("No remote printer");
		const agent = await this.#getAuthorizedAgent(req, {
			url: conf.url
		});
		return agent.fetch(`/data/deliveries-by-courier/${iso_code}`);
	}
	static couriers = {
		title: 'Couriers',
		$action: 'read',
		$global: true,
		required: ['iso_code'],
		properties: {
			iso_code: {
				$ref: "/elements#/definitions/print_job/properties/data/properties/delivery/properties/iso_code"
			}
		}
	};

	async #getAuthorizedAgent({ site }, data) {
		const email = site.data.printers?.remote?.login;
		const password = site.data.printers?.remote?.password;
		const conf = {
			url: data.url,
			email,
			password
		};
		const agent = new this.Agent(this.opts, data.url);
		agent.bearer = this.#bearers.get(conf);
		if (!agent.bearer) {
			agent.bearer = (await agent.fetch("/login", "post", {
				email, password
			})).token;
			this.#bearers.set(conf, agent.bearer);
		}
		return agent;
	}

	async #remoteJob(req, block) {
		const { remote: conf } = this.opts;
		if (!conf) throw new HttpError.BadRequest("No remote printer");
		const agent = await this.#getAuthorizedAgent(req, {
			url: conf.url
		});

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
		req.finish(async () => req.try(
			block,
			(req, block) => this.#remoteCall(req, block, obj)
		));
		return block;
	}

	async #remoteCall(req, block, { agent, pdf, coverPdf, courier }) {
		const orderEndpoint = req.site.data.env == "production" ? "/order/create" : "/order/sandbox-create";
		const { device, options } = block.data;
		const pdfUrl = req.call('page.format', {
			url: block.data.url,
			lang: block.data.lang,
			ext: 'pdf'
		});
		pdfUrl.searchParams.set('pdf', device);

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
			coverUrl.searchParams.set('pdf', device);
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
		const pdfRun = req.call('statics.file', 'cache', `${block.id}-content.pdf`);
		pdfRun.count = await this.#publicPdf(
			req, printProduct.pdf, pdfRun.path
		);
		clean.push(pdfRun.path);
		printProduct.pdf = pdfRun.url;

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
			const coverRun = req.call('statics.file', 'cache', `${block.id}-cover.pdf`);
			coverRun.count = await this.#publicPdf(
				req, printProduct.cover_pdf, coverRun.path
			);
			clean.push(coverRun.path);
			printProduct.cover_pdf = coverRun.url;
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
			const ret = await agent.fetch(orderEndpoint, "post", {
				data: order
			});
			if (ret.status != "ok") {
				console.info("Order response", ret);
				throw new HttpError.BadRequest(ret.msg);
			}
			block.data.order.id = ret.order_id;
			block.data.order.price = ret.total_price;
		} finally {
			for (const file of clean) await fs.unlink(file);
		}
	}

	async #publicPdf(req, url, file) {
		const res = await req.run('prerender.save', {
			url: url.pathname + url.search
		});
		await fs.mkdir(Path.parse(file).dir, { recursive: true });
		await fs.mv(res.path, file);

		return res.headers['x-page-count'];
	}
};


function findCourier(list, type) {
	const name = {
		express: 'courier',
		standard: 'letter'
	}[type];
	return list.find(item => item.courier.includes(name));
}
