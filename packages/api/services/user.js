module.exports = class UserService {
	static name = 'user';
	static $global = true;

	#QueryUser({ trx, Block }, data) {
		if (!data.id && !data.email) {
			throw new HttpError.BadRequest("Missing id or email");
		}
		return Block.query(trx).alias('user').columns()
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
		$lock: true,
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

	async add(req, data) {
		try {
			return await this.#QueryUser(req, data);
		} catch (err) {
			if (err.status != 404) throw err;
		}
		const user = await req.Block.query(req.trx).insert({
			data: { email: data.email },
			type: 'user'
		}).returning('*');
		await req.call('login.priv', user);
		return user;
	}
	static add = {
		title: 'Add user',
		$lock: true,
		$action: 'write',
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


	async save({ trx, Block }, { id, data }) {
		const user = await this.#QueryUser({ trx, Block }, { id });
		await user.$query(trx).patchObject({ data });
		return user;
	}
	static save = {
		title: 'Save user',
		$lock: true,
		$action: 'write',
		required: ['id', 'data'],
		properties: {
			id: {
				type: 'string',
				minLength: 1,
				format: 'id'
			},
			data: {
				type: 'object',
				properties: {
					name: {
						title: 'Name',
						type: 'string',
						nullable: true,
						format: 'singleline'
					},
					email: {
						title: 'User email',
						type: 'string',
						format: 'email',
						transform: ['trim', 'toLowerCase']
					}
				}
			}
		}
	};

	async del(req, data) {
		return this.#QueryUser(req, data).del();

	}
	static del = {
		...this.add,
		title: 'Delete user',
		$lock: true,
		$action: 'write'
	};
};


