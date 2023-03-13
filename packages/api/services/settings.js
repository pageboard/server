const { ref } = require('objection');

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

	async find({ site, trx }, data) {
		if (!data.id && !data.email) {
			throw new HttpError.BadRequest("Missing id or email");
		}
		const settings = await site.$relatedQuery('children', trx).alias('settings')
			.where('settings.type', 'settings')
			.where(q => {
				if (data.id) {
					q.where('parent.id', data.id);
				} else if (data.email) {
					q.whereJsonText('parent.data:email', data.email);
				}
			})
			.first().throwIfNotFound()
			.joinRelated('parents', { alias: 'parent' }).where('parent.type', 'user')
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
	static find = {
		title: 'Find user settings',
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

	async search({ site, trx }, data) {
		return site.$relatedQuery('children', trx).alias('settings')
			.where('settings.type', 'settings')
			.first().throwIfNotFound()
			.select().select(ref('parent.data:email').as('email'))
			.joinRelated('parents', { alias: 'parent' }).where('parent.type', 'user')
			.whereJsonText('parent.data:email', 'in', data.email);
	}
	static search = {
		title: 'Search user settings',
		$action: 'read',
		required: ['email'],
		properties: {
			email: {
				title: 'User emails',
				type: 'array',
				items: {
					type: 'string',
					format: 'email',
					transform: ['trim', 'toLowerCase']
				}
			}
		}
	};

	async save(req, data) {
		const { trx, site } = req;
		try {
			const settings = await req.run('settings.find', data);
			if (!data.data) return settings;
			if (data.data.grants) {
				// delete data.data.grants;
			}
			if (Object.keys(data.data).length == 0) return settings;
			await settings.$query(trx).patchObject({
				type: settings.type,
				data: data.data
			});
			return settings;
		} catch (err) {
			if (err.statusCode != 404) throw err;
		}
		const user = await req.run('user.add', {
			email: data.email
		});
		const block = {
			type: 'settings',
			data: data.data,
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
		$action: 'save',
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
				type: 'object',
				default: {}
			}
		}
	};
};
