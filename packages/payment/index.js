const Stripe = require.lazy('stripe');
const { hash } = require('../../src/utils');
const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });

module.exports = class PaymentModule {
	static name = 'payment';
	static priority = 100;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async elements(elements) {
		elements.site.$lock['data.payment'] = 'webmaster';
		elements.site.properties.payment = {
			title: 'Payment',
			properties: {
				key: {
					title: 'Private key',
					type: 'string',
					format: 'singleline'
				},
				pub: {
					title: 'Public key',
					type: 'string',
					format: 'singleline'
				},
				hook: {
					title: 'Hook secret',
					type: 'string',
					format: 'singleline'
				}
			}
		};
		const { payment } = await import('./src/payment.mjs');
		payment.properties.currency = PaymentModule.initiate.properties.currency;
		return { payment };
	}

	apiRoutes(router) {
		router.read("/payment/config", 'payment.config');
		router.write("/payment/hook", 'payment.hook');
	}

	#config(site) {
		const { payment } = site.data;
		if (!payment?.key || !payment?.hook || !payment?.pub) {
			throw new HttpError.NotImplemented("Missing configuration");
		} else {
			return {
				...payment,
				hash: hash(payment.key)
			};
		}
	}

	#stripe(req) {
		const origSite = this.app.domains.site(req.site.id);
		let { $stripe: inst } = origSite;
		const conf = this.#config(origSite);
		if (!inst || inst.$hash != conf.hash) {
			inst = origSite.$stripe = new Stripe(conf.key);
			inst.$hash = conf.hash;
			inst.$hook = conf.hook;
		}
		return inst;
	}

	async config(req) {
		return {
			publishableKey: this.#config(req.site).pub
		};
	}
	static config = {
		title: 'Config',
		$action: 'read'
	};

	async initiate(req, data) {
		const stripe = this.#stripe(req);
		const ret = await req.run('block.find', {
			type: 'payment',
			data: {
				job: data.job
			}
		});
		const payment = ret.item ?? (await req.run('block.add', {
			type: 'payment',
			data
		})).item;

		const paymentIntent = await stripe.paymentIntents.create({
			currency: data.currency,
			amount: data.amount,
			metadata: {
				id: payment.id
			}
		});
		return {
			clientSecret: paymentIntent.client_secret
		};
	}
	static initiate = {
		title: 'Initiate',
		$action: 'write',
		required: ['job', 'amount', 'currency'],
		properties: {
			job: {
				title: 'Job',
				type: 'string',
				format: 'id'
			},
			amount: {
				title: 'Amount',
				type: 'integer',
				minimum: 0
			},
			currency: {
				title: 'Currency',
				type: 'string',
				anyOf: Intl.supportedValuesOf("currency").map(str => {
					return {
						const: str,
						title: currencyNames.of(str)
					};
				})
			}
		}
	};

	async hook(req, data) {
		const $stripe = this.#stripe(req);
		const event = $stripe.webhooks.constructEvent(
			req.buffer,
			req.get('stripe-signature'),
			$stripe.$hook
		);
		const {
			type,
			data: {
				object: {
					metadata: {
						id
					} = {}
				} = {}
			} = {}
		} = event;
		if (!id) throw new HttpError.BadRequest("Missing id");
		let status;
		if (type == "payment_intent.created") {
			status = 'waiting';
		} else if (type == 'payment_intent.succeeded') {
			status = 'paid';
		} else if (type == 'payment_intent.canceled') {
			status = 'canceled';
		} else if (type == 'payment_intent.payment_failed') {
			status = 'failed';
		} else {
			throw new HttpError.BadRequest("Unsupported notification type: " + type);
		}
		const payment = await req.run('block.get', { id });
		if (payment.data.status == "paid") {
			return;
		}
		const ret = await req.run('block.save', {
			type: 'payment',
			id,
			data: { status }
		});
		await req.sql.trx.commit();
		if (status == "paid") {
			return ret;
		}
	}

	static hook = {
		title: 'Hook',
		$action: 'write',
		properties: {
			type: {
				title: 'Event',
				type: 'string',
				format: 'singleline'
			},
			data: {
				title: 'Data',
				type: 'object'
			}
		}
	};

};
