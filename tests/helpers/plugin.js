module.exports = class FakeModule {
	static name = 'fake';

	constructor(app) {
		this.app = app;
	}
	command(req, data) {
		return data;
	}
	static command = {
		title: 'Fake',
		properties: {
			str: {
				type: 'string'
			},
			data: {
				type: 'object',
				properties: {
					list: {
						type: 'array',
						items: {
							type: 'string'
						}
					}
				}
			}
		}
	};
};
