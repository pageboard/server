export const print_job = {
	title: 'Print Job',
	required: ['url', 'printer'],
	bundle: true,
	standalone: true,
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
			description: 'Preconfigured printer type',
			type: 'string'
		},
		response: {
			title: 'Response',
			type: 'object',
			properties: {
				status: {
					title: 'Status',
					type: 'integer',
					nullable: true
				},
				text: {
					title: 'Text',
					type: 'string',
					nullable: true
				}
			}
		},
		order: {
			title: 'Order',
			type: 'object',
			nullable: true,
			properties: {
				id: {
					title: 'ID',
					type: 'string',
					format: 'id'
				},
				price: {
					title: 'Price',
					type: 'number'
				}
			}
		},
		options: {
			title: 'Print options',
			type: 'object',
			properties: {
				product: {
					title: 'Product',
					type: 'integer'
				},
				additionalProduct: {
					title: 'Extra product',
					description: 'A product id already prepared by the remote printer',
					type: 'integer',
					nullable: true
				},
				cover: {
					type: 'object',
					properties: {
						sides: {
							title: 'Sides',
							type: 'integer'
						},
						paper: {
							title: 'Paper',
							type: 'integer'
						}
					}
				},
				content: {
					type: 'object',
					properties: {
						paper: {
							title: 'Paper',
							type: 'integer'
						}
					}
				},
				binding: {
					title: 'Binding',
					type: 'integer'
				},
				binding_placement: {
					title: 'Binding placement',
					default: 'left',
					anyOf: [{
						const: 'left',
						title: 'Left'
					}, {
						const: 'right',
						title: 'Right'
					}]
				}
			}
		},
		delivery: {
			title: 'Delivery',
			type: 'object',
			nullable: true,
			required: ['iso_code', 'name', 'phone', 'email', 'street', 'city', 'zip'],
			properties: {
				courier: {
					title: 'Courier',
					anyOf: [{
						const: 'standard',
						title: 'Standard'
					}, {
						const: 'express',
						title: 'Express'
					}]
				},
				iso_code: {
					title: 'Country Code',
					type: 'string',
					format: 'singleline'
				},
				name: {
					title: 'Name',
					type: 'string',
					format: 'singleline'
				},
				phone: {
					title: 'Phone',
					type: 'string',
					format: 'phone'
				},
				email: {
					title: 'Email',
					type: 'string',
					format: 'email'
				},
				street: {
					title: 'Street',
					type: 'string'
				},
				city: {
					title: 'City',
					type: 'string',
					format: 'singleline'
				},
				zip: {
					title: 'Zip Code',
					type: 'string',
					format: 'singleline'
				}
			}
		}
	}
};
