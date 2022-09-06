exports = module.exports = function(opt) {
	return {
		name: 'form',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/form", (req, res, next) => {
		next(new HttpError.MethodNotAllowed("Only post allowed"));
	});
	All.app.post("/.api/form/:id", (req, res, next) => {
		All.run('form.submit', req, {
			id: req.params.id,
			query: req.query,
			body: All.utils.unflatten(req.body)
		}).then((data) => {
			All.send(res, data);
		}).catch(next);
	});
}

exports.submit = function(req, data) {
	return All.run('block.get', req, {
		id: data.id
	}).then((form) => {
		const fd = form.data || {};
		const method = (fd.action || {}).method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}
		if (All.auth.locked(req, (form.lock || {}).write)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}
		let body = data.body;
		// build parameters
		const expr = ((form.expr || {}).action || {}).parameters || {};
		let params = All.utils.mergeParameters(expr, {
			$request: body,
			$query: data.query || {},
			$user: req.user
		});
		params = All.utils.mergeObjects(params, fd.action.parameters);

		Log.api("form params", params, req.user, data.query);

		// build body
		if (params.type && Object.keys(body).length > 0) {
			const el = req.site.$schema(params.type);
			if (!el) throw new HttpError.BadRequest("Unknown element type " + params.type);
			const newBody = {data: {}};
			Object.keys((el.properties.data || {}).properties || {}).forEach((key) => {
				const val = body[key];
				if (val !== undefined) {
					newBody.data[key] = val;
					delete body[key];
				}
			});
			Object.keys(el.properties).forEach((key) => {
				const mkey = '$' + key;
				const mval = body[mkey];
				if (mval !== undefined) {
					newBody[key] = mval;
				} else {
					const val = body[key];
					if (val !== undefined) {
						console.warn(`Use $${key} for setting el.properties[key]`);
						newBody[key] = val;
					}
				}
			});
			if (el.parents) {
				const parent = body.$parent ?? body.$parents;
				if (parent) {
					newBody.parents = Array.isArray(parent) ? parent : [parent];
				}
			}
			body = newBody;
		}
		body = All.utils.mergeObjects(body, params);

		return All.run(method, req, body).catch((err) => {
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

