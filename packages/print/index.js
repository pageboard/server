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
			list.unshift({
				name: 'storage'
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
		if (name == "storage" && this.opts.storage) {
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
		if (printer == "storage" && this.opts.storage) {
			await fs.promises.rename(path, Path.join(this.opts.storage, Path.basename(path)));
			return {};
		} else {
			const ret = await cups.printFile(path, {
				printer,
				printerOptions: options
			});
			if (ret.stdout) console.info(ret.stdout);
			await fs.promises.unlink(path);
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

	async remote(req, {
		url, printer, options = {}, delivery = {}
	}) {
		const { expresta: conf } = this.opts;
		if (!conf) throw new HttpError.NotFound("No remote printer");
		const agent = new BearerAgent(this.opts, conf.url);

		agent.bearer = (await agent.fetch("/login", "post", {
			email: conf.email,
			password: conf.password
		})).token;

		const products = await agent.fetch("/data/products");
		const product = products.find(item => item.url == options.product);
		if (!product) {
			return {
				status: 400,
				statusText: 'Unknown product',
				items: products
			};
		}

		const papers = await agent.fetch("/data/papers");
		const paper = papers.find(item => item.id == options.paper);
		if (!paper) {
			return {
				status: 400,
				statusText: 'Unknown paper',
				items: papers
			};
		}

		const folds = await agent.fetch("/data/folds");
		const fold = folds.find(item => item.id == options.fold);
		if (!fold && options.fold) {
			return {
				status: 400,
				statusText: 'Unknown fold',
				items: folds
			};
		}

		const bindings = await agent.fetch("/data/bindings");
		const binding = bindings.find(item => item.id == options.binding);
		if (!binding) {
			return {
				status: 400,
				statusText: 'Unknown binding',
				items: bindings
			};
		}

		const couriers = await agent.fetch(`/data/deliveries-by-courier/${delivery.iso_code}`);
		const courier = couriers.find(item => item.courier == delivery.courier);
		if (!courier) {
			return {
				status: 400,
				statusText: 'Unknown courier',
				items: couriers
			};
		}

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


		// https://api.expresta.com/api/v1/order/sandbox-create for testing orders


		const order = {
			customer_reference: "1234567890",
			delivery,
			products: [{
				product_type_id: product.id, // GetProducts id
				pdf: pdfUrl.href,
				binding_id: binding.id,
				binding_placement: "left",
				amount: 1,
				runlists: [{
					size_a: sizeA,
					size_b: sizeB,
					paper_id: paper.id,
					bleed: !margin,
					fold_type_id: fold?.id,
					fold_on: options.fold_on
				}]
			}]
		};
		//const price = await agent.fetch("/order/calculate-price", "post", {data: order});
		const ret = await agent.fetch("/order/sandbox-create", "post", { data: order });
		return {
			type: 'order',
			data: {
				order
				//price
			},
			status: ret.status == "error" ? 500 : 200,
			statusText: ret.msg
		};
	}
	static remote = {
		title: 'Remote print',
		$action: 'write',
		required: ['url', 'delivery', 'printer', 'options'],
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
				title: 'Printer service',
				description: 'Choose a supported printer service',
				anyOf: [{ const: 'expresta', title: 'Expresta' }]
			},
			options: {
				title: 'Print options',
				type: 'object',
				//required: ['product', 'paper', 'size'],
				properties: {
					product: {
						title: 'Product',
						type: 'string',
						format: 'singleline'
					},
					paper: {
						title: 'Paper',
						type: 'string',
						format: 'id',
						default: '420'
					},
					fold: {
						title: 'Fold',
						type: 'string',
						format: 'id',
						default: '19'
					},
					fold_on: {
						title: 'Fold on',
						default: null,
						anyOf: [{
							type: 'null',
							title: 'n/a'
						}, {
							const: 'axis_longer',
							title: 'Long side'
						}, {
							const: 'axis_longer',
							title: 'Short side'
						}]
					},
					binding: {
						title: 'Binding',
						type: 'string',
						format: 'id',
						default: '254' // paperback, perfect binding
					}
				}
			},
			delivery: {
				title: 'Delivery',
				type: 'object',
				//required: ['iso_code', 'name', 'phone', 'email', 'street', 'city', 'zip'],
				properties: {
					courier: {
						title: 'Courier' // as obtained by GetDeliveriesByCourier

					},
					iso_code: {
						title: 'Country Code' // the same used to call GetDeliveriesByCourier
					},
					name: {

					},
					phone: {

					},
					email: {

					},
					street: {

					},
					city: {

					},
					zip: {

					}
				}
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


function convertLengthToMillimiters(str = '') {
	const num = parseFloat(str);
	if (Number.isNaN(num)) return 0;
	const { groups: { unit } } = /\d+(?<unit>\w+)/.exec(str) ?? { groups: {} };
	if (unit == "cm") return num * 10;
	else if (unit == "mm") return num;
}
