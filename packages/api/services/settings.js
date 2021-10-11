const ref = require('objection').ref;

exports = module.exports = function (opt) {
	return {
		name: 'settings',
		service: init
	};
};

function init() {
	All.app.get("/.api/settings", (req, res, next) => {
		All.run('settings.get', req, {
			id: req.user.id
		}).then((data) => {
			All.send(res, data);
		}).catch(next);
	});

	All.app.put('/.api/settings', All.auth.lock('webmaster'), (req, res, next) => {
		All.run('settings.save', req, req.body).then((data) => {
			All.send(res, data);
		}).catch(next);
	});
}

exports.get = function ({ site, trx }, data) {
	return site.$relatedQuery('children', trx)
		.where('block.type', 'settings')
		.where('block.id', data.id).first().throwIfNotFound().select()
		.withGraphFetched('[parents(userFilter) as parent]')
		.modifiers({
			userFilter(query) {
				query.select().where('type', 'user');
			}
		}).then((settings) => {
			settings.parent = settings.parent[0];
			settings.parent.lock = {
				read: [`id-${settings.id}`]
			};
			return settings;
		});
};
exports.get.schema = {
	title: 'Get User',
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
exports.get.external = true;

exports.find = function ({ site, trx }, data) {
	const q = site.$relatedQuery('children', trx).alias('settings')
		.where('settings.type', 'settings')
		.first().throwIfNotFound()
		.joinRelated('parents', { alias: 'parent' }).where('parent.type', 'user')
		.withGraphFetched('[parents(userFilter) as parent]')
		.modifiers({
			userFilter(query) {
				query.select().where('type', 'user');
			}
		});
	if (!data.id && !data.email) throw new HttpError.BadRequest("Missing id or email");
	if (data.id) q.where('parent.id', data.id);
	else if (data.email) q.whereJsonText('parent.data:email', data.email);
	return q.then((settings) => {
		settings.parent = settings.parent[0];
		settings.parent.lock = {
			read: [`id-${settings.id}`]
		};
		return settings;
	});
};
Object.defineProperty(exports.find, 'schema', {
	get: function () {
		return All.user.get.schema;
	}
});

exports.search = function ({ site, trx }, data) {
	const q = site.$relatedQuery('children', trx).alias('settings')
		.where('settings.type', 'settings')
		.first().throwIfNotFound()
		.select().select(ref('parent.data:email').as('email'))
		.joinRelated('parents', { alias: 'parent' }).where('parent.type', 'user');
	q.whereJsonText('parent.data:email', 'in', data.email);
	return q;
};
exports.search.schema = {
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

exports.save = function (req, data) {
	const site = req.site;
	return All.settings.find(req, data).then((settings) => {
		if (!data.data) return settings;
		if (data.data.grants) {
			// delete data.data.grants;
		}
		if (Object.keys(data.data).length == 0) return settings;
		return settings.$query(req.trx).patchObject({ data: data.data }).then(() => {
			return settings;
		});
	}).catch((err) => {
		if (err.statusCode != 404) throw err;
		return All.user.get(req, { email: data.email }).select('_id').catch((err) => {
			if (err.statusCode != 404) throw err;
			return All.user.add(req, { email: data.email }).then((user) => {
				return All.user.get(req, { email: data.email }).select('_id');
			});
		}).then((user) => {
			const block = {
				type: 'settings',
				data: data.data,
				parents: [user]
			};
			return site.$beforeInsert.call(block).then(() => {
				block.lock = { read: [`id-${block.id}`] };
				return site.$relatedQuery('children', req.trx).insertGraph(block, {
					relate: ['parents']
				}).then((settings) => {
					settings.parent = settings.parents[0];
					delete settings.parents;
					settings.email = user.data.email;
					return settings;
				});
			});
		});
	});
};
Object.defineProperty(exports.save, 'schema', {
	get: function () {
		const schema = Object.assign({}, All.user.get.schema);
		schema.$action = 'save';
		schema.properties = Object.assign({
			data: {
				type: 'object',
				default: {}
			}
		}, schema.properties);
		return schema;
	}
});

