exports = module.exports = function(opt) {
	return {
		name: 'settings'
	};
};

exports.get = function(site, data) {
	return site.$relatedQuery('children').alias('settings')
	.where('settings.type', 'settings')
	.where('settings.id', data.id).first().throwIfNotFound().select();
};
exports.get.schema = {
	$action: 'read',
	required: ['id'],
	properties: {
		id: {
			type: 'string',
			minLength: 1,
			format: 'id'
		}
	}
};

exports.find = function(site, data) {
	var q = site.$relatedQuery('children').alias('settings')
	.where('settings.type', 'settings').first().throwIfNotFound().select()
	.joinRelation('parents', {alias: 'user'});
	if (!data.id && !data.email) throw new HttpError.BadRequest("Missing id or email");
	if (data.id) q.where('user.id', data.id);
	else if (data.email) q.whereJsonText('user.data:email', 'in', data.email);
	return q;
};
Object.defineProperty(exports.find, 'schema', {
	get: function() {
		return All.user.get.schema;
	}
});

exports.save = function(site, data) {
	return exports.find(site, data).then(function(settings) {
		return settings.$query(site.trx).patchObject({data: data.data}).then(function() {
			return settings;
		});
	}).catch(function(err) {
		if (err.statusCode != 404) throw err;
		return All.run('user.get', {email: data.email}).catch(function(err) {
			if (err.statusCode != 404) throw err;
			return All.run('user.add', {data: {email: data.email}});
		}).then(function(user) {
			return site.$model.query(site.trx).insertGraph({
				type: 'settings',
				data: data.data,
				parents: [site, user]
			}, {
				relate: ['parents']
			}).then(function(settings) {
				delete settings.parents;
				return settings;
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

