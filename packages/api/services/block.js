var ref = require('objection').ref;

exports = module.exports = function(opt) {
	return {
		name: 'block',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/block", function(req, res, next) {
		var type = req.query.type;
		if (!type || ['user', 'site', 'page'].indexOf(type) >= 0) {
			return next(new HttpError.BadRequest("Cannot request that type"));
		}
		All.run('block.get', req.site, req.query).then(function(data) {
			res.json(data);
		}).catch(next);
	});
}

exports.get = function(site, data) {
	var q = site.$relatedQuery('children').select()
		.where('block.id', data.id);
	if (data.type) q.where('block.type', data.type);
	if (data.standalone) q.eager(`[children(childrenFilter)]`, {
		childrenFilter: function(query) {
			return query.select().where('block.standalone', false);
		}
	});
	return q.first().throwIfNotFound();
};
exports.get.schema = {
	required: ['id'],
	properties: {
		id: {
			type: 'string'
		},
		type: {
			type: 'string'
		},
		standalone: {
			type: 'boolean',
			default: false
		}
	},
	additionalProperties: false
};

exports.search = function(site, data) {
	var q = site.$relatedQuery('children').select()
		.whereIn('block.type', data.type);
	if (data.parent) {
		q.joinRelation('parents as parent').where('parent.id', data.parent);
	}
	if (data.children) q.eager('[children(childrenFilter)]', {
		childrenFilter: function(query) {
			query.select();
			if (data.children.type) query.whereIn('block.type', data.children.type);
		}
	});
	if (data.id) {
		q.where('block.id', data.id);
	}
	if (data.data) {
		q.whereObject({data: data.data});
	}
	if (data.text != null) {
		var text = data.text.split(/\W+/).filter(x => !!x).map(x => x + ':*').join(' <-> ');
		q.from(Block.raw([
			Block.raw("to_tsquery('unaccent', ?) AS query", [text]),
			'block'
		]));
		q.whereRaw('query @@ block.tsv');
		q.orderByRaw('ts_rank(block.tsv, query) DESC');
	}
	q.orderBy('updated_at', 'block.desc');
	q.offset(data.offset).limit(data.limit);
	return q.then(function(rows) {
		var obj = {
			data: rows,
			offset: data.offset,
			limit: data.limit
		};
		obj.schemas = {};
		data.type.concat(data.children && data.children.type || []).forEach(function(type) {
			var sch = site.$schema(type);
			if (sch) obj.schemas[type] = sch;
			else console.warn(`Unknown schema for type '${type}'`);
		});
		return obj;
	});
};
exports.search.schema = {
	required: ['type'],
	properties: {
		text: {
			type: 'string'
		},
		parent: {
			type: 'string'
		},
		id: {
			type: 'string'
		},
		data: {
			type: 'object'
		},
		type: {
			type: 'array',
			items: {
				type: 'string',
				not: { // TODO permissions should be managed dynamically
					oneOf: [{
						const: "user"
					}, {
						const: "site"
					}]
				}
			}
		},
		children: {
			type: 'object',
			required: ['type'],
			properties: {
				type: {
					type: 'array',
					items: {
						type: 'string',
						not: { // TODO permissions should be managed dynamically
							oneOf: [{
								const: "user"
							}, {
								const: "site"
							}]
						}
					}
				}
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
	},
	additionalProperties: false
};
exports.search.external = true;

exports.find = function(site, data) {
	data.limit = 1;
	data.offset = 0;
	return exports.search(site, data).then(function(obj) {
		return {
			data: obj.data.length == 1 ? obj.data[0] : null,
			schemas: obj.schemas
		};
	});
};
exports.find.schema = {
	required: ['id', 'type'],
	properties: {
		id: {
			type: 'string'
		},
		type: {
			type: 'array',
			items: {
				type: 'string',
				not: { // TODO permissions should be managed dynamically
					oneOf: [{
						const: "user"
					}, {
						const: "site"
					}]
				}
			}
		},
		children: exports.search.schema.properties.children
	},
	additionalProperties: false
};
exports.find.external = true;

exports.add = function(site, data) {
	var id = data.parent;
	delete data.parent;
	return All.api.trx(function(trx) {
		return site.$relatedQuery('children', trx).insert(data).then(function(child) {
			if (!id) return child;
			return site.$relatedQuery('children', trx).where('block.id', id)
			.select('_id').first().throwIfNotFound().then(function(parent) {
				return parent.$relatedQuery('children', trx).relate(child);
			});
		});
	});
};
exports.add.schema = {
	properties: {
		parent: {
			type: 'string'
		}
	},
	additionalProperties: true
};
exports.add.external = true;

exports.save = function(site, data) {
	return All.api.trx(function(trx) {
		return exports.get(site, data).transacting(trx).forUpdate().then(function(block) {
			return site.$relatedQuery('children', trx).patchObject(data)
			.where('block.id', block.id).then(function(count) {
				if (count == 0) throw new Error(`Block not found for update ${data.id}`);
			});
		});
	});
};
exports.save.schema = {
	required: ['id', 'type'],
	properties: {
		id: {
			type: 'string'
		},
		type: {
			type: 'string'
		}
	},
	additionalProperties: true
};
exports.save.external = true;

exports.del = function(site, data) {
	// TODO check data.type to not be site, user
	return site.$relatedQuery('children').where('id', data.id).where('type', data.type).delete();
};
exports.del.schema = {
	required: ['id', 'type'],
	properties: {
		id: {
			type: 'string'
		},
		type: {
			type: 'string'
		}
	},
	additionalProperties: false
};
exports.del.external = true;

exports.gc = function(days) {
	return All.api.Block.raw(`DELETE FROM block USING (
		SELECT count(relation.child_id), b._id FROM block AS b
			LEFT OUTER JOIN relation ON (relation.child_id = b._id)
			LEFT JOIN block AS p ON (p._id = relation.parent_id AND p.type='site')
		WHERE b.type NOT IN ('user', 'site') AND extract('day' from now() - b.updated_at) >= ?
		GROUP BY b._id
	) AS usage WHERE usage.count = 0 AND block._id = usage._id`, [
		days
	]).then(function(result) {
		return {
			length: result.rowCount
		};
	});
};

