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
			type: 'numeric'
		},
		currency: {
			title: 'Currency',
			type: 'string'
		}
	}
};
