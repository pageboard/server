var ref = require('objection').ref;
var lodash = require('objection').lodash;

exports = module.exports = function(opt) {
	return {
		name: 'site',
		service: init
	};
};

function init(All) {
}

function QuerySite(data) {
	var Block = All.api.Block;
	var q = Block.query().alias('site')
	.first().throwIfNotFound()
	.where('site.type', 'site').where(function(q) {
		if (data.id) q.orWhere('site.id', data.id);
		if (data.domain) q.orWhere(ref('site.data:domain').castText(), data.domain);
	});
	return q;
}

exports.get = function(data) {
	return QuerySite(data).select();
};

exports.get.schema = {
	properties: {
		id: {
			type: 'string'
		},
		domain: {
			type: 'string'
		}
	},
	additionalProperties: false,
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
		data.grants.forEach(function(grant, i) {
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
	required: ['email'],
	properties: {
		email: {
			type: 'string',
			format: 'email'
		},
		grants: {
			type: 'array',
			items: {
				type: 'string'
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
	required: ['id', 'email', 'data'],
	properties: {
		id: {
			type: 'string'
		},
		data: {
			type: 'object'
		}
	},
	additionalProperties: false
};

exports.save = function(data) {
	return All.api.trx(function(trx) {
		return exports.get(data).select('_id').transacting(trx).forUpdate().then(function(site) {
			lodash.merge(site.data, data.data);
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

