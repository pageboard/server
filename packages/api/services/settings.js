module.exports = class SettingsService {
	static name = 'settings';

	apiRoutes(router) {
		router.read("/settings/get", async req => {
			return req.filter(req.run('settings.get', {
				id: req.user.id
			}));
		});

		router.write('/settings/save', 'settings.save');
	}
	async get(req, { id }) {
		return req.run('block.find', {
			id,
			type: 'settings',
			parents: {
				first: true,
				type: 'user'
			}
		});
	}
	static get = {
		title: 'Get',
		$action: 'read',
		required: ['id'],
		properties: {
			id: {
				title: 'Settings id',
				type: 'string',
				minLength: 1,
				format: 'id'
			}
		}
	};

	async find(req, data) {
		return req.call('block.find', {
			type: ['settings'],
			parents: {
				first: true,
				type: ['user']
			},
			parent: {
				data: {
					email: data.email
				}
			}
		});
	}
	static find = {
		title: 'Find',
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

	async list(req, { grant, email, limit, offset }) {
		if (req.locked(['webmaster'])) {
			throw new HttpError.Forbidden("Method only allowed for webmaster");
		}
		const data = {};
		if (grant === null) data.grants = null;
		else if (grant !== undefined) data['grants:has'] = [grant];

		const parent = {};
		if (email) parent.data = { 'email:has': email };
		const obj = await req.run('block.search', {
			type: 'settings',
			data,
			parent,
			parents: {
				type: 'user',
				first: true
			},
			limit, offset,
			order: '-created_at'
		});
		obj.items = obj.items.filter(item => {
			return !req.locked(item.data.grants);
		}).map(item => ({
			type: 'email_grant',
			data: { email: item.parent.data.email }
		}));
		return obj;
	}
	static list = {
		title: 'List granted',
		$action: 'read',
		properties: {
			grant: {
				title: 'Filter by grant',
				description: 'Empty for no grant',
				type: 'string',
				format: 'grant',
				nullable: true
			},
			email: {
				title: 'Filter by email',
				type: 'string',
				format: 'singleline',
				nullable: true
			},
			limit: {
				title: 'Limit',
				type: 'integer',
				minimum: 0,
				maximum: 1000,
				default: 10
			},
			offset: {
				title: 'Offset',
				type: 'integer',
				default: 0
			}
		}
	};

	async grant(req, { email, grant }) {
		if (req.locked([grant], true)) {
			// TODO req.user must also have a "grant" manager permission
			throw new HttpError.Forbidden("Higher grant is needed");
		}
		const obj = await req.run('settings.have', { email });
		const { grants = [] } = obj.item.data ?? {};
		if (grant && !grants.includes(grant)) {
			grants.push(grant);
			await req.run('block.save', {
				id: obj.item.id,
				type: 'settings',
				data: {
					grants
				}
			});
		}
	}
	static grant = {
		title: 'Grant',
		description: 'A higher permission is needed to grant a lower permission',
		$action: 'write',
		required: ['email', 'grant'],
		properties: {
			email: {
				title: 'User email',
				type: 'string',
				format: 'email',
				transform: ['trim', 'toLowerCase']
			},
			grant: {
				title: 'Grant',
				type: 'string',
				format: 'grant'
			}
		}
	};

	async revoke(req, { email, grant }) {
		if (req.locked([grant], true)) { // TODO req.user must also have a "grant" manager permission
			throw new HttpError.Forbidden("Higher grant is needed");
		}
		const obj = await req.run('settings.find', { email });
		if (!obj.item) return;
		const { grants = [] } = obj.item.data ?? {};

		if (grant && grants.includes(grant)) {
			grants.splice(grants.indexOf(grant), 1);
			await req.run('block.save', {
				id: obj.item.id,
				type: 'settings',
				data: {
					grants
				}
			});
		}
	}
	static revoke = {
		title: 'Revoke',
		description: 'A higher permission is needed to revoke a lower permission',
		$action: 'write',
		required: ['email', 'grant'],
		properties: {
			email: {
				title: 'User email',
				type: 'string',
				format: 'email',
				transform: ['trim', 'toLowerCase']
			},
			grant: {
				title: 'Grant',
				type: 'string',
				format: 'grant'
			}
		}
	};

	async have(req, { email }) {
		// TODO custom data ?
		const res = await req.run('settings.find', { email });
		if (res.item) return res;
		if (res.$status != 404) throw HttpError.from(res.$status, res.$statusText);
		const user = await req.run('user.add', { email });
		const block = {
			id: await req.sql.Block.genId(),
			type: 'settings',
			parents: [user]
		};
		const { site, sql: { trx } } = req;
		block.lock = [`id-${block.id}`];
		const settings = await site.$relatedQuery('children', trx)
			.insertGraph(block, {
				relate: ['parents']
			});
		delete settings.parents;
		settings.parent = user;
	}

	static have = {
		title: 'Have email',
		$action: 'write',
		required: ['email'],
		properties: {
			email: {
				title: 'User email',
				type: 'string',
				format: 'email',
				transform: ['trim', 'toLowerCase']
			},
			data: {
				title: 'Data',
				type: 'object',
				additionalProperties: true,
				default: {}
			}
		}
	};

	async save(req, { id, data }) {
		if (Object.keys(data).length == 0) return { id, data };
		if (data.grants && req.locked(data.grants, true)) {
			throw new HttpError.Forbidden("Higher grant is needed");
		}

		// const { item } = await req.run('settings.get', { id });


		return req.site.$relatedQuery('children', req.sql.trx)
			.where('type', 'settings')
			.where('id', id).patchObject({
				type: 'settings',
				data
			})
			.returning('*');
	}

	static save = {
		title: 'Save',
		$action: 'write',
		required: ['id'],
		$lock: 'webmaster',
		$tags: ['data-:site'],
		properties: {
			id: {
				title: 'User settings ID',
				type: 'string',
				minLength: 1,
				format: 'id'
			},
			data: {
				title: 'Data',
				type: 'object',
				additionalProperties: true,
				default: {}
			}
		}
	};
};
