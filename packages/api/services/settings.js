var ref = require('objection').ref;

exports = module.exports = function(opt) {
	return {
		name: 'settings',
		service: init
	};
};

function init() {

}

exports.get = function({site, trx}, data) {
	return site.$relatedQuery('children', trx)
	.where('block.type', 'settings')
	.where('block.id', data.id).first().throwIfNotFound().select()
	.eager('[parents(userFilter) as user]', {
		userFilter: function(query) {
			query.select().where('type', 'user');
		}
	}).then(function(settings) {
		settings.user = settings.user[0];
		return settings;
	});
};
exports.get.schema = {
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
exports.get.external = true;

exports.find = function({site, trx}, data) {
	var q = site.$relatedQuery('children', trx).alias('settings')
	.where('settings.type', 'settings').first().throwIfNotFound().select().select(ref('user.data:email').as('email'))
	.joinRelation('parents', {alias: 'user'}).where('user.type', 'user');
	if (!data.id && !data.email) throw new HttpError.BadRequest("Missing id or email");
	if (data.id) q.where('user.id', data.id);
	else if (data.email) q.whereJsonText('user.data:email', data.email);
	return q;
};
Object.defineProperty(exports.find, 'schema', {
	get: function() {
		return All.user.get.schema;
	}
});

exports.search = function({site, trx}, data) {
	var q = site.$relatedQuery('children', trx).alias('settings')
	.where('settings.type', 'settings').first().throwIfNotFound().select().select(ref('user.data:email').as('email'))
	.joinRelation('parents', {alias: 'user'}).where('user.type', 'user');
	q.whereJsonText('user.data:email', 'in', data.email);
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

exports.save = function(req, data) {
	var site = req.site;
	return All.run('settings.find', req, data).then(function(settings) {
		return settings.$query(req.trx).patchObject({data: data.data}).then(function() {
			return settings;
		});
	}).catch(function(err) {
		if (err.statusCode != 404) throw err;
		return All.run('user.get', req, {email: data.email}).catch(function(err) {
			if (err.statusCode != 404) throw err;
			return All.run('user.add', req, {email: data.email});
		}).then(function(user) {
			var block = {
				type: 'settings',
				data: data.data,
				parents: [site, user]
			};
			return site.$beforeInsert.call(block).then(function() {
				block.lock = {read: [`id-${block.id}`]};
				return site.$query(req.trx).insertGraph(block, {
					relate: ['parents']
				}).then(function(settings) {
					delete settings.parents;
					return settings;
				});
			});
		});
	});
};
Object.defineProperty(exports.save, 'schema', {
	get: function() {
		var schema = Object.assign({}, All.user.get.schema);
		schema.$action = 'save';
		schema.properties = Object.assign({
			data: {
				type: 'object'
			}
		}, schema.properties);
		return schema;
	}
});

