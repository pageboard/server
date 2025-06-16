export const payment = {
	title: 'Payment',
	required: ['currency', 'amount'],
	bundle: true,
	standalone: true,
	properties: {
		id: {
			title: 'Order',
			type: 'string',
			format: 'id'
		},
		amount: {
			title: 'Amount',
			type: 'number',
			multipleOf: 0.01,
		},
		currency: {
			title: 'Currency',
			type: 'string'
		}
	}
};
