module.exports = class RedirectService {
	static name = 'redirect';

	get(req, data) {
		return data;
	}
	static get = {
		title: 'Get',
		$action: 'read'
	};

	post(req, data) {
		return data;
	}
	static post = {
		title: 'Post',
		$action: 'write'
	};
};
