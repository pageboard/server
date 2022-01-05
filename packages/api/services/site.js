const lodashMerge = require.lazy('lodash.merge');

exports = module.exports = function (opt) {
	return {
		name: 'site',
		service: init
	};
};

function init(All) {
	All.app.put('/.api/site', All.auth.lock('webmaster'), (req, res, next) => {
		const data = Object.assign(req.body, { id: req.site.id });
		All.run('site.save', req, data).then((site) => {
			res.send(site);
		}).catch(next);
	});
}

function QuerySite({ trx }, data) {
	const Block = All.api.Block;
	const q = Block.query(trx).alias('site').first()
		.where('site.type', 'site').where((q) => {
			if (data.id) q.orWhere('site.id', data.id);
			if (data.domain) q.orWhereJsonHasAny('site.data:domains', data.domain);
		});
	return q;
}

exports.get = function (req, data) {
	return QuerySite(req, data).throwIfNotFound().select().select("_id");
};

exports.get.schema = {
	title: 'Get site',
	$action: 'read',
	properties: {
		id: {
			title: 'ID',
			type: 'string',
			format: 'id'
		},
		domain: {
			title: 'Domain',
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

exports.search = function ({ trx }, data) {
	const Block = All.api.Block;
	const q = Block.query(trx).alias('site').select().where('site.type', 'site')
		.joinRelated('children', { alias: 'settings' })
		.where('settings.type', 'settings');
	if (data.grants) q.where((builder) => {
		data.grants.forEach((grant) => {
			builder.orWhereJsonSupersetOf('settings.data:grants', [grant]);
		});
	});
	return q.joinRelated('parents', { alias: 'user' })
		.where('user.type', 'user')
		.whereJsonText('user.data:email', data.email)
		.orderBy('site.updated_at', 'site.desc')
		.offset(data.offset)
		.limit(data.limit).then((rows) => {
			const obj = {
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
	title: 'Search user sites',
	$action: 'read',
	required: ['email'],
	properties: {
		email: {
			title: 'Email',
			type: 'string',
			format: 'email'
		},
		grants: {
			title: 'Grants',
			type: 'array',
			items: {
				type: 'string',
				format: 'grant'
			}
		},
		limit: {
			title: 'Limit',
			type: 'integer',
			minimum: 0,
			maximum: 50,
			default: 10
		},
		offset: {
			title: 'Offset',
			type: 'integer',
			minimum: 0,
			default: 0
		}
	}
};

exports.add = function (req, data) {
	return QuerySite(req, { id: data.id }).then((site) => {
		if (site) {
			throw new HttpError.Conflict("Site id already exists");
		} else {
			data.type = 'site';
			return All.api.Block.query(req.trx).insert(data);
		}
	});
};

exports.add.schema = {
	title: 'Add site',
	$action: 'add',
	required: ['id', 'data'],
	properties: {
		id: {
			title: 'ID',
			type: 'string',
			format: 'id'
		},
		data: {
			title: 'Data',
			type: 'object'
		}
	}
};

exports.save = function (req, data) {
	return exports.get(req, data).then((site) => {
		lodashMerge(site.data, data.data);
		if (req.site && req.site.href) site.href = req.site.href;
		return All.install(site).then((site) => {
			const copy = Object.assign({}, data.data);
			if (site.server) copy.server = site.server;
			return site.$query(req.trx).patchObject({
				type: site.type,
				data: copy
			}).then(() => {
				return site;
			});
		});
	});
};
exports.save.schema = {
	title: 'Save site',
	$action: 'save',
	required: ['id', 'data'],
	properties: {
		id: {
			title: 'ID',
			type: 'string',
			format: 'id'
		},
		data: {
			title: 'Data',
			type: 'object',
			default: {}
		}
	}
};

exports.all = function ({ trx }) {
	return All.api.Block.query(trx).where('type', 'site').select();
};
exports.all.schema = {
	title: 'List all sites',
	$action: 'read'
};

exports.del = function ({ trx }, data) {
	const Block = All.api.Block;
	const counts = {};
	return Block.query(trx).where('type', 'site')
		.select('_id', trx.raw('recursive_delete(_id, TRUE) AS blocks'))
		.where('id', data.id)
		.first().throwIfNotFound().then((row) => {
			counts.blocks = row.blocks;
			// no need to remove href thanks to delete cascade on href._parent_id
		}).then(() => {
			return counts;
		});
};
exports.del.schema = {
	title: 'Delete a site',
	$action: 'del',
	required: ['id'],
	properties: {
		id: {
			title: 'ID',
			type: 'string',
			format: 'id'
		}
	}
};

exports.gc = function ({ trx }) {
	// deletes all blocks that belong to no site
	return trx.raw(`DELETE FROM block
WHERE block.type NOT IN ('site', 'user') AND NOT EXISTS (SELECT c._id FROM block c, relation r, block p
WHERE c._id = block._id AND r.child_id = c._id AND p._id = r.parent_id AND p.type IN ('site', 'user')
GROUP BY c._id HAVING count(*) >= 1)`);
};
