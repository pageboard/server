const Stripe = require.lazy('stripe');
const { hash } = require('../../src/utils');

module.exports = class PaymentModule {
	static name = 'payment';
	static priority = 100;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
		this.opts.apiVersion = '2025-05-28.basil';
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
				}
			}
		};
		return import('./src/payment.mjs');
	}

	apiRoutes(router) {
		router.read("/payment/config", 'payment.config');
		router.write("/payment/hook", 'payment.hook');
	}

	#config(site) {
		const { payment } = site.data;
		if (!payment?.key || !payment?.pub) {
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
			inst = origSite.$stripe = new Stripe(conf.key, {
				apiVersion: this.opts.apiVersion
			});
			inst.$hash = conf.hash;
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

		if (payment.data.status == "paid") throw new HttpError.BadRequest("Order already paid");

		const customer = await stripe.customers.create();
		const ephemeralKey = await stripe.ephemeralKeys.create({
			customer: customer.id
		}, {
			// We expect the client to use the same version as ours, see also
			// https://github.com/stripe/stripe-node/issues/2351
			apiVersion: data.apiVersion || this.opts.apiVersion
		});
		const paymentIntent = await stripe.paymentIntents.create({
			currency: data.currency,
			amount: data.amount,
			customer: customer.id,
			metadata: {
				id: payment.id
			}
		});
		return {
			paymentIntent: paymentIntent.client_secret,
			ephemeralKey: ephemeralKey.secret,
			customer: customer.id,
			publishableKey: req.site.data.payment.pub
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
				$filter: {
					name: 'intl',
					of: 'currency'
				}
			},
			apiVersion: {
				title: 'Client API Version',
				type: 'string',
				format: 'singleline',
				nullable: true
			}
		}
	};

	async hook(req, data) {
		const $stripe = this.#stripe(req);
		const event = $stripe.webhooks.constructEvent(
			req.buffer,
			req.get('stripe-signature'),
			data.secret
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
		} else if (type?.startsWith('payment_intent.')) {
			console.info("Ignoring payment_intent notification:", type);
			return;
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
			},
			secret: {
				title: 'Hook secret',
				type: 'string',
				format: 'singleline'
			}
		}
	};

};
