module.exports = class UserService {
	static name = 'user';

	async #QueryUser({ trx, Block }, data) {
		if (!data.id && !data.email) {
			throw new HttpError.BadRequest("Missing id or email");
		}
		return Block.query(trx).alias('user').select()
			.first().throwIfNotFound()
			.where('user.type', 'user')
			.where(q => {
				if (data.id) {
					q.where('user.id', data.id);
				} else if (data.email) {
					q.whereJsonText('user.data:email', data.email);
				}
			});
	}

	async get(req, data) {
		return this.#QueryUser(req, data);
	}
	static get = {
		title: 'Get user',
		$lock: 'root',
		$action: 'read',
		anyOf: [{
			required: ['email']
		}, {
			required: ['id']
		}],
		properties: {
			id: {
				type: 'string',
				minLength: 1,
				format: 'id'
			},
			email: {
				title: 'User email',
				type: 'string',
				format: 'email',
				transform: ['trim', 'toLowerCase']
			}
		}
	};

	async add({ trx, Block }, data) {
		try {
			return await this.#QueryUser({ trx, Block }, data);
		} catch (err) {
			if (err.status != 404) throw err;
		}
		return Block.query(trx).insert({
			data: { email: data.email },
			type: 'user'
		}).returning('*');
	}
	static add = {
		title: 'Add user',
		$lock: 'root',
		$action: 'add',
		required: ['email'],
		properties: {
			email: {
				title: 'User email',
				type: 'string',
				format: 'email',
				transform: ['trim', 'toLowerCase']
			}
		}
	};

	async del(req, data) {
		return this.#QueryUser(req, data).del();
	}
	static del = {
		...this.add,
		title: 'Delete user',
		$lock: 'root',
		$action: 'del'
	};
};


