exports = module.exports = function(opt) {
	return {
		name: 'site',
		service: init
	};
};

function init(All) {
}

function QuerySite(data) {
	var q = All.api.Block.query().alias('site')
	.first().throwIfNotFound()
	.where('site.type', 'site');
	if (data.id) q.where('site.id', data.id);
	else if (data.domain) q.whereJsonText('site.data:domain', data.domain);
	return q;
}

exports.get = function(data) {
	return QuerySite(data).select(All.api.Block.columns);
};

exports.get.schema = {
	anyOf: [{
		required: ['id'],
		properties: {
			id: {
				type: 'string'
			}
		}
	}, {
		required: ['domain'],
		properties: {
			domain: {
				type: 'string'
			}
		}
	}],
	additionalProperties: false
};

exports.search = function(data) {
	var Block = All.api.Block;
	return Block.query().select(Block.tableColumns)
	.joinRelation('parents as owners')
	.whereJsonText('owners.data:email', data.email)
	.orderBy('updated_at', 'block.desc')
	.offset(data.offset)
	.limit(data.limit).then(function(rows) {
		var obj = {
			data: rows,
			offset: data.offset,
			limit: data.limit
		};
		obj.schemas = {
			site: Block.schemaByType('site')
		};
		return obj;
	});
};
exports.search.schema = {
	required: ['email'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		limit: {
			type: 'integer',
			minimum: 0,
			maximum: 50,
			default: 10
		},
		offset: {
			type: 'integer',
			minimum: 0,
			default: 0
		}
	}
};

exports.add = function(data) {
	return QuerySite({id: data.id}).then(function(site) {
		console.info("There is already a site with this id", data.id);
	}).catch(function(err) {
		data = Object.assign({
			type: 'site'
		}, data);
		if (data.data.domain) {
			console.info("Use site.save to change site.data.domain");
			delete data.data.domain; // setting domain is done and checked elsewhere
		}
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
	required: ['id', 'email', 'data'],
	properties: {
		id: {
			type: 'string'
		},
		email: {
			type: 'string',
			format: 'email'
		},
		data: {
			type: 'object'
		}
	},
	additionalProperties: false
};

// TODO update cached All.domains.sites[site.id]

exports.save = function(data) {
	return exports.get(data).select('_id').then(function(site) {
		var sameModule = (data.data && data.data.module || null) == (site.data && site.data.module || null);
		var sameVersion = (data.data && data.data.version || null) == (site.data && site.data.version || null);
		Object.assign(site.data, data.data);
		return site.$query().patch(data).then(function(result) {
			if (sameModule == false || sameVersion == false) {
				return All.install(site).then(() => result);
			} else {
				return result;
			}
		});
	});
};
exports.save.schema = {
	required: ['id', 'data'],
	properties: {
		id: {
			type: 'string'
		},
		data: {
			type: 'object',
			default: {}
		}
	},
	additionalProperties: false
};

exports.del = function(data) {
	return QuerySite(data).del();
};
exports.del.schema = {
	required: ['id'],
	properties: {
		id: {
			type: 'string'
		}
	},
	additionalProperties: false
};

exports.own = function(data) {
	return QuerySite(data).select('site._id').then(function(site) {
		return All.user.get({
			email: data.email
		}).clearSelect().select('user._id')
		.eager('[children(ownedSites), parents(owningSites)]', {
			ownedSites: function(builder) {
				builder.alias('site').select('_id').where('site.id', data.id)
				.where('type', 'site');
			},
			owningSites: function(builder) {
				builder.alias('site').select('_id').where('site.id', data.id)
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
	required: ['email', 'id'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		id: {
			type: 'string'
		}
	},
	additionalProperties: false
};
