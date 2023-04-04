module.exports = class SettingsService {
	static name = 'settings';

	apiRoutes(app, server) {
		server.get("/.api/settings", async (req, res) => {
			const data = await req.run('settings.get', {
				id: req.user.id
			});
			res.return(data);
		});

		server.put('/.api/settings', app.auth.lock('webmaster'), async (req, res) => {
			const data = await req.run('settings.save', req.body);
			res.return(data);
		});
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
		title: 'Get user settings',
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
		return req.run('block.find', {
			type: 'settings',
			parents: {
				first: true,
				type: 'user'
			},
			parent: {
				data: {
					email: data.email
				}
			}
		});
	}
	static find = {
		title: 'Find user settings',
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

	async search(req, data) {
		const { items } = await req.run('block.search', {
			type: 'settings',
			parents: {
				type: 'user',
				first: true
			},
			parent: data
		});
		return {
			items: items.map(item => {
				item.data = { grants: item.data.grants };
				return item;
			})
		};
	}
	static search = {
		title: 'Search users',
		$action: 'read',
		properties: {
			data: {
				title: 'Data',
				type: 'object',
				default: {}
			}
		}
	};

	async grant(req, { email, grant }) {
		if (req.locked([grant], true)) {
			throw new HttpError.Forbidden("Higher grant is needed");
		}
		const obj = await this.have(req, email);
		const { grants = [] } = obj.item.data ?? {};
		if (!grants.includes(grant)) {
			grants.push(grant);
			return req.run('block.save', {
				id: obj.item.id,
				type: 'settings',
				data: {
					grants
				}
			});
		} else {
			return obj;
		}
	}
	static grant = {
		title: 'Grant user permission',
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
		if (req.locked([grant], true)) {
			throw new HttpError.Forbidden("Higher grant is needed");
		}
		const obj = await req.run('settings.find', { email });
		const { grants = [] } = obj.item?.data ?? {};

		if (grants.includes(grant)) {
			grants.splice(grants.indexOf(grant), 1);
			return req.run('block.save', {
				id: obj.item.id,
				type: 'settings',
				data: {
					grants
				}
			});
		} else {
			return obj;
		}
	}
	static revoke = {
		title: 'Revoke user permission',
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

	async have(req, email) {
		try {
			return await req.run('settings.find', { email });
		} catch (err) {
			if (err.statusCode != 404) throw err;
			const user = await req.run('user.add', { email });
			const block = {
				type: 'settings',
				parents: [user]
			};
			const { site, trx } = req;
			await site.$beforeInsert.call(block); // prepopulate block.id
			block.lock = { read: [`id-${block.id}`] };
			const settings = await site.$relatedQuery('children', trx)
				.insertGraph(block, {
					relate: ['parents']
				});
			delete settings.parents;
			return settings;
		}
	}

	async save(req, { id, data }) {
		const settings = await req.run('settings.get', { id });
		if (data.grants) {
			throw new HttpError.Unauthorized("Cannot change grants");
		}
		if (Object.keys(data).length == 0) return settings;
		await settings.$query(req.trx).patchObject({
			type: 'settings',
			data
		});
		return settings;
	}

	static save = {
		title: 'Save user settings',
		$action: 'write',
		required: ['id'],
		properties: {
			id: {
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
