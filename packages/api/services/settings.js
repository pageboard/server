exports = module.exports = function(opt) {
	return {
		name: 'settings'
	};
};

exports.get = function(site, data) {
	return site.$relatedQuery('children').alias('settings')
	.where('settings.type', 'settings').first().throwIfNotFound().select()
	.joinRelation('parents', {alias: 'user'})
	.where('user.id', data.user_id);
};
exports.get.schema = {
	required: ['user_id'],
	properties: {
		user_id: {
			type: 'string'
		}
	},
	additionalProperties: false
};


exports.save = function(site, data) {
	return exports.get(site, data).select('settings._id').then(function(settings) {
		return settings.$query().patchObject({data: data.data}).then(function() {
			delete settings._id;
			return settings;
		});
	}).catch(function(err) {
		if (err.statusCode != 404) throw err;
		return All.user.get({id: data.user_id}).select('_id').then(function(user) {
			return site.$model.query().insertGraph({
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
exports.save.schema = {
	required: ['user_id'],
	properties: {
		user_id: {
			type: 'string'
		},
		data: {
			type: 'object'
		}
	},
	additionalProperties: false
};

