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
		All.run('form.submit', req.site, {
			id: req.params.id,
			query: All.utils.unflatten(req.query),
			body: All.utils.unflatten(req.body),
			user: req.user
		}).then(function(data) {
			All.send(res, data);
		}).catch(next);
	});
}

exports.submit = function(site, data) {
	return All.run('block.get', site, {
		id: data.id
	}).then(function(form) {
		var fd = form.data || {};
		var method = fd.action.method;
		if (!method) throw new HttpError.BadRequest("Missing method");
		// build parameters
		var expr = ((form.expr || {}).action || {}).parameters || {};
		var params = All.utils.mergeParameters(expr, {
			$query: data.query,
			$user: data.user
		});
		params = All.utils.mergeObjects(params, fd.action.parameters);

		// build body
		var body = data.body;
		if (params.type && Object.keys(body).length > 0) {
			body = {data: body};
		}
		body = All.utils.mergeObjects(body, params);

		return All.run(method, site, body);
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
			type: 'object'
		},
		body: {
			type: 'object'
		}
	}
};

