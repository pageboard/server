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
	async get({ site, trx }, data) {
		const settings = await site.$relatedQuery('children', trx)
			.where('block.type', 'settings')
			.where('block.id', data.id).first().throwIfNotFound().select()
			.withGraphFetched('[parents(userFilter) as parent]')
			.modifiers({
				userFilter(query) {
					query.select().where('type', 'user');
				}
			});
		settings.parent = settings.parent[0];
		settings.parent.lock = {
			read: [`id-${settings.id}`]
		};
		return settings;
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
		return { items: items.map(row => row.parent) };
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

	async save(req, { email, data }) {
		const { trx, site } = req;
		try {
			const settings = await req.run('settings.find', { email, data });
			if (!data) return settings;
			if (Object.keys(data).length == 0) return settings;
			await settings.$query(trx).patchObject({
				type: 'settings',
				data
			});
			return settings;
		} catch (err) {
			if (err.statusCode != 404) throw err;
		}
		const user = await req.run('user.add', {
			email
		});
		const block = {
			type: 'settings',
			data,
			parents: [user]
		};
		await site.$beforeInsert.call(block);
		block.lock = { read: [`id-${block.id}`] };
		const settings = await site.$relatedQuery('children', trx)
			.insertGraph(block, {
				relate: ['parents']
			});
		settings.parent = settings.parents[0];
		delete settings.parents;
		settings.email = user.data.email;
		return settings;
	}

	static save = {
		title: 'Save/Add user settings',
		$action: 'write',
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
			},
			data: {
				title: 'Data',
				type: 'object',
				additionalProperties: true,
				properties: {
					grants: {
						title: 'Grants',
						type: 'array',
						uniqueItems: true,
						items: {
							type: 'string'
						}
					},
				},
				default: {}
			}
		}
	};
};
