module.exports = class RedirectService {
	static name = 'redirect';

	get(req, data) {
		return data;
	}
	static get = {
		title: 'Get',
		$action: 'read',
		additionalProperties: true,
		properties: {}
	};

	post(req, data) {
		return data;
	}
	static post = {
		title: 'Post',
		$action: 'write',
		additionalProperties: true,
		properties: {}
	};
};
