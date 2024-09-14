const Stripe = require('stripe');

module.exports = class StripeModule {
	static name = 'stripe';
	static priority = 100;

	#stripe;

	constructor(app, opts) {
		this.app = app;
		this.opts = opts;
	}

	async init() {
		this.#stripe = Stripe(this.opts.secretKey, {
			apiVersion: '2023-10-16', // ??
			appInfo: {
				name: 'pageboard',
				version: this.app.version,
				url: 'https://github.com/pageboard/server'
			}
		});
	}

	async elements() {
		return {};
	}

	apiRoutes(app, server) {
		app.get("/@api/stripe/config", 'stripe.config');
		app.get("/@api/stripe/intent", 'stripe.intent');
		app.post("/@api/stripe/hook", 'stripe.hook');
	}

	async config(req) {
		return {
			publishableKey: this.opts.publishableKey
		};
	}
	static config = {
		title: 'Get config',
		$action: 'read'
	};

	async intent(req, data) {
		const paymentIntent = await this.#stripe.paymentIntents.create({
			currency: data.currency,
			amount: data.amount,
			automatic_payment_methods: {
				enabled: true
			}
		});
		return {
			clientSecret: paymentIntent.client_secret
		};
	}
	static intent = {
		title: 'Get payment intent',
		$action: 'read',
		required: ['amount', 'currency'],
		properties: {
			amount: {
				title: 'Amount',
				type: 'numeric'
			},
			currency: {
				title: 'Currency',
				type: 'string',
				format: 'name' // replace by anyOf usb, eur, etc ..?
			}
		}
	};

	async hook(req) {
		const event = this.#stripe.webhooks.constructEvent(
			req.buffer,
			req.get('stripe-signature'),
			this.opts.webhookSecret
		);
		const { type, data } = event;
		// TODO store payment details in a payment block
		if (type === 'payment_intent.succeeded') {
			// Funds have been captured
			// Fulfill any orders, e-mail receipts, etc
			// To cancel the payment after capture you will need to issue a Refund (https://stripe.com/docs/api/refunds)
			console.info('💰 Payment captured!', data);
		} else if (type === 'payment_intent.payment_failed') {
			console.info('❌ Payment failed.', data);
		}
	}

	static hook = {
		title: 'Webhook',
		$action: 'write',
		required: [],
		properties: {

		}
	};

};
