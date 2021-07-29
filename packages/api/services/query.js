exports = module.exports = function(opt) {
	return {
		name: 'search',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/query/:id", function(req, res, next) {
		All.run('search.query', req, {
			id: req.params.id,
			query: req.query
		}).then(function(data) {
			All.send(res, data);
		}).catch(next);
	});
	All.app.post("/.api/query", function(req, res, next) {
		next(new HttpError.NotImplemented());
	});
}

exports.query = function(req, data) {
	return All.run('block.find', req, {
		id: data.id,
		type: 'fetch',
		parents: {
			type: req.site.$pages,
			first: true
		}
	}).then(function (obj) {
		const form = obj.item;
		const fd = form.data || {};
		const method = (fd.action || {}).method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}
		if (All.auth.locked(req, (form.lock || {}).read)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}
		// build parameters
		const expr = ((form.expr || {}).action || {}).parameters || {};
		let params = All.utils.mergeParameters(expr, {
			$query: data.query || {},
			$user: req.user
		});
		params = All.utils.mergeObjects(params, fd.action.parameters);
		return All.run(method, req, params).then(obj => {
			const parentType = form.parent.type;
			const bundles = req.site.$bundles;
			const bundle = bundles[parentType];
			const metas = {};
			Object.keys(fillTypes(obj.item || obj.items, {})).forEach((type) => {
				if (bundle.elements.includes(type)) return;
				const bundleType = Object.keys(bundles).find((key) => {
					return key != parentType && bundles[key].elements.includes(type);
				});
				if (bundleType) {
					if (metas[bundleType]) {
						console.warn("Element is bundled in several types", type);
					} else {
						metas[bundleType] = bundles[bundleType].meta;
					}
				}
			});
			obj.metas = Object.values(metas);
			return obj;
		}).catch(function (err) {
			return {
				status: err.statusCode || err.status || err.code || 400,
				item: {
					type: 'error',
					data: {
						message: err.message
					}
				}
			};
		});
	});
};

exports.query.schema = {
	$action: 'read',
	required: ['id'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		query: {
			type: 'object',
			nullable: true
		}
	},
	additionalProperties: false
};

function fillTypes(list, obj) {
	if (!list) return obj;
	if (!Array.isArray(list)) list = [list];
	for (const row of list) {
		if (row.type) obj[row.type] = true;
		if (row.parent) fillTypes(row.parent, obj);
		if (row.child) fillTypes(row.child, obj);
		if (row.parents) fillTypes(row.parents, obj);
		if (row.children) fillTypes(row.children, obj);
	}
	return obj;
}
