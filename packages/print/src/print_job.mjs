export const print_job = {
	title: 'Print Job',
	required: ['url', 'printer', 'device'],
	bundle: true,
	standalone: true,
	$lock: {
		'data.options.discount': 'webmaster'
	},
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
		lang: {
			title: 'Language',
			type: 'string',
			format: 'lang',
			nullable: true,
			$helper: {
				name: 'datalist',
				url: '/@api/languages'
			}
		},
		printer: {
			title: 'Printer',
			description: 'Preconfigured printer type',
			type: 'string'
		},
		device: {
			title: 'Device',
			anyOf: [{
				const: 'screen',
				title: 'Screen'
			}, {
				const: 'ebook',
				title: 'Ebook'
			}, {
				const: 'printer',
				title: 'Printer'
			}]
		},
		response: {
			title: 'Job response',
			$filter: 'hide',
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
				},
				time: {
					title: 'Time',
					type: 'number',
					nullable: true
				}
			}
		},
		order: {
			title: 'Order response',
			$filter: 'hide',
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
					type: 'string',
					format: 'singleline'
				},
				status: {
					title: 'Status',
					type: 'string',
					format: 'singleline',
					nullable: true
				}
			}
		},
		tracking: { // tracking_url
			title: 'Tracking',
			type: 'object',
			nullable: true,
			properties: {
				url: {
					title: 'URL',
					type: 'string',
					format: "uri-reference"
				},
				parcel: { // package_number
					title: 'Parcel',
					type: 'string',
					format: 'singleline'
				},
				quantity: { // packages_amount
					title: 'Quantity',
					type: 'integer'
				},
				since: { // created
					title: 'Since',
					type: 'string',
					format: 'date-time'
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
				discount: {
					title: 'Discount Code',
					type: 'string',
					format: 'singleline',
					nullable: true
				},
				bleed: {
					title: 'Trim bleed margins',
					type: 'boolean'
				},
				cover: {
					title: 'Cover',
					type: 'object',
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
					title: 'Content',
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
