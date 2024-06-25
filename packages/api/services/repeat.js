module.exports = class RepeatService {
	static name = 'repeat';

	get(req, data) {
		return data;
	}
	static get = {
		title: 'Redirect',
		$action: 'read'
	};

	post(req, data) {
		return data;
	}
	static post = {
		title: 'Redirect',
		$action: 'write'
	};
};
