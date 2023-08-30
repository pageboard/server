exports.site = {
	title: 'Site',
	bundle: true,
	standalone: true,
	$lock: true,
	properties: {
		title: {
			title: 'Site title',
			nullable: true,
			type: "string"
		},
		domains: {
			title: 'Domain names',
			description: 'The main domain and the redirecting ones if any',
			nullable: true,
			type: "array",
			items: {
				type: "string",
				format: 'hostname'
			}
		},
		module: {
			title: 'Module name',
			description: 'npm name, or git url',
			nullable: true,
			type: "string",
			format: "singleline"
		},
		version: {
			title: 'Module version',
			description: 'Semantic version or git tag or commit',
			nullable: true,
			type: "string",
			format: "singleline" // a "version" format ?
		},
		server: {
			title: 'Server version',
			description: 'Major.minor pageboard server version',
			nullable: true,
			type: "string",
			pattern: /^\d+\.\d+$/.source
		},
		lang: {
			title: 'Locale',
			description: 'Single language',
			nullable: true,
			type: "string",
			format: 'lang'
		},
		languages: {
			title: 'Languages',
			description: 'Default language must be first',
			type: 'array',
			items: {
				type: 'string',
				format: 'lang'
			},
			nullable: true
		},
		env: {
			title: 'Environment',
			anyOf: [{
				const: 'dev',
				title: 'Development'
			}, {
				const: 'staging',
				title: 'Staging'
			}, {
				const: 'production',
				title: 'Production'
			}],
			default: 'dev'
		},
		favicon: {
			title: 'Favicon',
			nullable: true,
			type: "string",
			format: "pathname",
			$helper: {
				name: 'href',
				display: 'icon',
				filter: {
					type: ["image", "svg"],
					maxSize: 20000,
					maxWidth: 320,
					maxHeight: 320
				}
			}
		},
		author: {
			title: 'Author',
			nullable: true,
			type: "string",
			format: "singleline"
		},
		license: {
			title: 'License',
			nullable: true,
			type: "string",
			format: "singleline"
		}
	}
};

exports.print_job = {
	title: 'Print',
	required: ['url', 'printer'],
	bundle: 'site',
	$lock: true,
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
					type: 'integer',
					default: 8620 // Books (Book printing)
				},
				additionalProduct: {
					title: 'Extra product',
					description: 'A product id already prepared by the remote printer',
					type: 'integer',
					nullable: true
				},
				cover: {
					type: 'object',
					default: {},
					properties: {
						sides: {
							title: 'Sides',
							type: 'integer',
							default: 2
						},
						paper: {
							title: 'Paper',
							type: 'integer',
							default: 673 // Matt one-sided laminated (0.31 mm / 315 g/m²)
						}
					}
				},
				content: {
					type: 'object',
					default: {},
					properties: {
						paper: {
							title: 'Paper',
							type: 'integer',
							default: 436
						}
					}
				},
				binding: {
					title: 'Binding',
					type: 'integer',
					default: 254 // paperback, perfect binding
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

exports.mail_job = {
	title: 'Email',
	bundle: 'site',
	$lock: true,
	required: ['url', 'to'],
	properties: {
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
		purpose: {
			title: 'Purpose',
			anyOf: [{
				title: "Transactional",
				const: "transactional"
			}, {
				title: "Conversations",
				const: "conversations"
			}, {
				title: "Subscriptions",
				const: "subscriptions"
			}],
			default: 'transactional'
		},
		from: {
			title: 'From',
			description: 'User settings.id or email',
			anyOf: [{
				type: 'string',
				format: 'id'
			}, {
				type: 'string',
				format: 'email'
			}]
		},
		replyTo: {
			title: 'Reply To',
			description: 'Email address or user id',
			anyOf: [{
				type: 'string',
				format: 'id'
			}, {
				type: 'string',
				format: 'email'
			}]
		},
		to: {
			title: 'To',
			description: 'List of email addresses or users id',
			type: 'array',
			items: {
				anyOf: [{
					type: 'string',
					format: 'id'
				}, {
					type: 'string',
					format: 'email'
				}]
			}
		},
		url: {
			title: 'Mail page',
			type: "string",
			format: "pathname",
			$filter: {
				name: 'helper',
				helper: {
					name: 'page',
					type: 'mail'
				}
			},
			$helper: 'href'
		},
		subject: {
			title: 'Subject',
			description: 'Defaults to mail page title',
			type: 'string',
			nullable: true
		},
		body: {
			title: 'Query',
			type: 'object',
			default: {}
		}
	}
};
