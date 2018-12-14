var lodashMerge = require('lodash.merge');

exports = module.exports = function(opt) {
	return {
		name: 'site',
		service: init
	};
};

function init(All) {
	All.app.put('/.api/site', All.auth.restrict('webmaster'), function(req, res, next) {
		var data = Object.assign(req.body, {id: req.site.id});
		All.run('site.save', data).then(function(site) {
			res.send(site);
		}).catch(next);
	});
}

function QuerySite(data) {
	/* gets distinct typesin this site as json array
	.select(
		Block.query().from('block AS b')
			.select(raw('array_to_json(array_agg(distinct b.type))'))
			.join('relation as r', 'b._id', 'r.child_id')
			.where('r.parent_id', ref('site._id'))
			.as('types')
	)
	*/
	var Block = All.api.Block;
	var q = Block.query().alias('site')
	.first().throwIfNotFound()
	.where('site.type', 'site').where(function(q) {
		if (data.id) q.orWhere('site.id', data.id);
		if (data.domain) q.orWhereJsonHasAny('site.data:domains', data.domain);
	});
	return q;
}

exports.get = function(data) {
	return QuerySite(data).select();
};

exports.get.schema = {
	$action: 'read',
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		domain: {
			type: 'string',
			format: 'hostname'
		}
	},
	anyOf: [{
		required: ['id']
	}, {
		required: ['domain']
	}]
};

exports.search = function(data) {
	var Block = All.api.Block;
	var q = Block.query().alias('site').select().where('site.type', 'site')
	.joinRelation('children', {alias: 'settings'})
	.where('settings.type', 'settings');
	if (data.grants) q.where(function(builder) {
		data.grants.forEach(function(grant) {
			builder.orWhereJsonSupersetOf('settings.data:grants', [grant]);
		});
	});
	return q.joinRelation('parents', {alias: 'user'})
	.where('user.type', 'user')
	.whereJsonText('user.data:email', data.email)
	.orderBy('site.updated_at', 'site.desc')
	.offset(data.offset)
	.limit(data.limit).then(function(rows) {
		var obj = {
			data: rows,
			offset: data.offset,
			limit: data.limit
		};
		obj.schemas = {
			site: Block.schema('site')
		};
		return obj;
	});
};
exports.search.schema = {
	$action: 'read',
	required: ['email'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		grants: {
			type: 'array',
			items: {
				type: 'string',
				format: 'id'
			}
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
		data.type = 'site';
		data.children = [{
			type: 'notfound',
			standalone: true
		}];
		return All.api.Block.query().insertGraph(data);
	});
};

exports.add.schema = {
	$action: 'add',
	required: ['id', 'data'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		data: {
			type: 'object'
		}
	}
};

exports.save = function(data) {
	return All.api.transaction(function(trx) {
		return exports.get(data).transacting(trx).forUpdate().then(function(site) {
			lodashMerge(site.data, data.data);
			return All.install(site).then(function(site) {
				return site.$query(trx).patchObject({
					type: site.type,
					data: data.data
				}).then(function() {
					return site;
				});
			});
		});
	});
};
exports.save.schema = {
	$action: 'save',
	required: ['id', 'data'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		data: {
			type: 'object',
			default: {}
		}
	}
};

exports.del = function(data) {
	return QuerySite(data).del();
};
exports.del.schema = {
	$action: 'del',
	required: ['id'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		}
	}
};

