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

	async grant(req, { email, grant }) {
		if (req.locked([grant], true)) {
			throw new HttpError.Forbidden("Higher grant is needed");
		}
		const obj = await req.run('settings.have', { email });
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

	async have(req, { email }) {
		// TODO custom data ?
		const res = await req.run('settings.find', { email });
		if (res.item) return res;
		if (res.status != 404) throw new HttpError[res.status]();
		const user = await req.run('user.add', { email });
		const block = {
			type: 'settings',
			parents: [user]
		};
		const { site, trx } = req;
		await site.$beforeInsert.call(block); // prepopulate block.id
		block.lock = [`id-${block.id}`];
		const settings = await site.$relatedQuery('children', trx)
			.insertGraph(block, {
				relate: ['parents']
			});
		delete settings.parents;
		settings.parent = user;
		return { item: settings };
	}

	static have = {
		title: 'Have user settings',
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
