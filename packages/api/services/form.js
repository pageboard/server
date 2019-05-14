exports = module.exports = function(opt) {
	return {
		name: 'form',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/form", function(req, res, next) {
		next(new HttpError.MethodNotAllowed("Only post allowed"));
	});
	All.app.post("/.api/form/:id", function(req, res, next) {
		All.run('form.submit', req, {
			id: req.params.id,
			query: All.utils.unflatten(req.query),
			body: All.utils.unflatten(req.body)
		}).then(function(data) {
			All.send(res, data);
		}).catch(next);
	});
}

exports.submit = function(req, data) {
	return All.run('block.get', req, {
		id: data.id
	}).then(function(form) {
		if (All.auth.locked(req, (form.lock || {}).write)) {
			throw HttpError.Unauthorized("Check user permissions");
		}
		var fd = form.data || {};
		var method = fd.action.method;
		if (!method) throw new HttpError.BadRequest("Missing method");
		// build parameters
		var expr = ((form.expr || {}).action || {}).parameters || {};
		var params = All.utils.mergeParameters(expr, {
			$query: data.query || {},
			$user: req.user
		});
		params = All.utils.mergeObjects(params, fd.action.parameters);

		// build body
		var body = data.body;
		if (params.type && Object.keys(body).length > 0) {
			var el = req.site.$schema(params.type);
			if (!el) throw new HttpError.BadRequest("Unknown element type " + params.type);
			var newBody = {data: {}};
			Object.keys((el.properties.data || {}).properties || {}).forEach(function(key) {
				var val = body[key];
				if (val !== undefined) {
					newBody.data[key] = val;
					delete body[key];
				}
			});
			Object.keys(el.properties).forEach(function(key) {
				var val = body[key];
				if (val !== undefined) newBody[key] = val;
			});
			body = newBody;
		}
		body = All.utils.mergeObjects(body, params);

		return All.run(method, req, body);
	});
};

exports.submit.schema = {
	$action: 'write',
	required: ["id"],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		query: {
			type: 'object',
			nullable: true
		},
		body: {
			type: 'object',
			nullable: true
		}
	}
};

