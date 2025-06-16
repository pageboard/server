const Stripe = require.lazy('stripe');
const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });

module.exports = class PaymentModule {
	static name = 'payment';
	static priority = 10000;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async elements(elements) {
		elements.site.$lock['data.stripe'] = 'root';
		elements.site.properties.stripe = {
			title: 'Stripe',
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
		const { stripe } = site.data;
		if (!stripe) {
			if (site.data.env != "production") return this.opts;
			else throw new HttpError.NotImplemented("Missing configuration");
		} else {
			return stripe;
		}
	}

	#stripe({ site }) {
		const origSite = this.app.domains.site(site.id);
		let { $stripe: inst } = origSite;
		const conf = this.#config(site);
		// FIXME find where key is stored in inst
		console.log(inst);
		if (!inst || inst.key != conf.key) {
			inst = origSite.$stripe = new Stripe(conf.key);
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
		const paymentIntent = await stripe.paymentIntents.create({
			currency: data.currency,
			amount: data.amount,
			metadata: {
				id: data.id,
				site: req.site.id
			}
		});
		return {
			clientSecret: paymentIntent.client_secret
		};
	}
	static initiate = {
		title: 'Initiate',
		$action: 'write',
		required: ['amount', 'currency'],
		properties: {
			id: {
				title: 'Order',
				type: 'string',
				format: 'id'
			},
			amount: {
				title: 'Amount',
				type: 'number',
				multipleOf: 0.01
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

	async hook(req) {
		if (!this.opts.hook) {
			throw new HttpError.NotImplemented("Missing configuration");
		}
		const event = this.#stripe(req).webhooks.constructEvent(
			req.buffer,
			req.get('stripe-signature'),
			this.opts.hook
		);
		const { type, data } = event;
		console.log(event);
		// TODO store payment details in a payment block
		if (type === 'payment_intent.created') {
			// created intent
		} else if (type === 'payment_intent.succeeded') {
			const { id, site } = data.metadata;
			if (!id) throw new HttpError.BadRequest("Unknown id: " + id);
			if (!site) throw new HttpError.BadRequest("Unknown site: " + site);
			// FIXME
			// app.run doesn't correctly deal with transactions ?
			// use req = req.sudo(site) to promote request as if it was received for site ?
			//
			// await this.app.run('do.something', { id }, { site });
			console.info('💰 Payment captured!', data);
		}
	}

	static hook = {
		title: 'Hook',
		$action: 'write',
		$private: true,
		$global: true
	};

};
