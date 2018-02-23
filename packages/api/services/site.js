exports = module.exports = function(opt) {
	return {
		name: 'site',
		service: init
	};
};

function init(All) {
}

function QuerySite(data) {
	var q = All.api.Block.query().alias('site').first().throwIfNotFound();
	if (data.id) {
		q.where('site.id', data.id);
	} else {
		q.whereJsonText('site.data:domain', data.domain).where('site.type', 'site');
	}
	return q;
}

exports.get = function(data) {
	return QuerySite(data).select(All.api.Block.columns);
};

exports.get.schema = {
	oneOf: [{
		required: ['domain'],
		properties: {
			domain: {
				type: 'string'
			}
		}
	}, {
		required: ['id'],
		properties: {
			id: {
				type: 'string'
			}
		}
	}]
};

exports.add = function(data) {
	return QuerySite({domain: data.data.domain}).then(function(site) {
		console.info("Not adding already existing site", data.data.domain);
	}).catch(function(err) {
		data = Object.assign({
			type: 'site'
		}, data);
		return All.user.get({
			email: data.email
		}).select('_id').then(function(user) {
			data.parents = [{
				'#dbRef': user._id
			}];
			data.children = [{
				'#dbRef': user._id // a user is also child of its own site
			}, {
				type: 'notfound',
				standalone: true
			}];
			delete data.email;
			return All.api.Block.query().insertGraph(data);
		});
	});
};

exports.add.schema = {
	required: ['email', 'data'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		data: Block.jsonSchema.selectCases.site
	}
};

exports.save = function(data) {
	return exports.get(data).then(function(site) {
		if (data.domain) delete data.domain;
		var sameDomain = (data.data && data.data.domain || null) == (site.data && site.data.domain || null);
		var sameModule = (data.data && data.data.module || null) == (site.data && site.data.module || null);
		// ensure we don't just empty site.data by mistake
		data.data = Object.assign({}, site.data, data.data);
		return All.api.Block.query().where('id', site.id).patch(data).then(function(result) {
			if (sameDomain) return result;
			return All.href.migrate({
				domain: site.data.domain,
				data: {
					domain: data.data.domain
				}
			}).then(function() {
				return result;
			});
		}).then(function(result) {
			if (sameModule == false) return All.install(data.data).then(() => result);
			else return result;
		});
	});
};
exports.save.schema = {
	required: ['domain', 'data'],
	properties: {
		domain: {
			type: 'string'
		},
		data: Block.jsonSchema.selectCases.site
	}
};

exports.del = function(data) {
	return QuerySite(data).del();
};
exports.del.schema = exports.get.schema;

exports.own = function(data) {
	if (!data.email) throw new HttpError.BadRequest("Missing email");
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	return QuerySite(data).select('site._id').then(function(site) {
		return All.user.get({
			email: data.email
		}).clearSelect().select('user._id')
		.eager('[children(ownedSites), parents(owningSites)]', {
			ownedSites: function(builder) {
				builder.select('_id').whereJsonText('data:domain', data.domain)
				.where('type', 'site');
			},
			owningSites: function(builder) {
				builder.select('_id').whereJsonText('data:domain', data.domain)
				.where('type', 'site');
			}
		}).then(function(user) {
			var proms = [];
			if (!user.children.length) {
				proms.push(user.$relatedQuery('children').relate(site).then(function() {
					return "user owns site";
				}));
			}
			if (!user.parents.length) {
				proms.push(user.$relatedQuery('parents').relate(site).then(function() {
					return "site owns user";
				}));
			}
			if (!proms.length) return "nothing to do";
			else return Promise.all(proms);
		});
	});
};
exports.own.schema = {
	required: ['email', 'domain'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		domain: {
			type: 'string'
		}
	}
};
