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
			query: All.utils.unflatten(req.query)
		}).then(function(data) {
			All.send(res, data);
		}).catch(next);
	});
	All.app.post("/.api/query", function(req, res, next) {
		next(new HttpError.NotImplemented());
	});
}

exports.query = function(req, data) {
	return All.run('block.get', req, {
		id: data.id
	}).then(function(form) {
		var fd = form.data || {};
		var method = (fd.action || {}).method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}
		if (All.auth.locked(req, (form.lock || {}).read)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}
		// build parameters
		var expr = ((form.expr || {}).action || {}).parameters || {};
		var params = All.utils.mergeParameters(expr, {
			$query: data.query || {},
			$user: req.user
		});
		params = All.utils.mergeObjects(params, fd.action.parameters);
		return All.run(method, req, params).catch(function(err) {
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

