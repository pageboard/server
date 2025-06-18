export const payment = {
	title: 'Payment',
	required: ['job', 'currency', 'amount'],
	bundle: true,
	standalone: true,
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
				name: 'currency'
			}
		},
		status: {
			title: 'Status',
			anyOf: [{
				const: null,
				title: 'New'
			}, {
				const: 'waiting',
				title: 'Waiting'
			}, {
				const: 'canceled',
				title: 'Canceled'
			}, {
				const: 'failed',
				title: 'Failed'
			}, {
				const: 'paid',
				title: 'Paid'
			}, {
				const: 'used',
				title: 'Used'
			}],
			default: null
		}
	}
};
