const {
	mergeParameters,
	mergeExpressions,
	unflatten
} = require('../../../lib/utils');

module.exports = class FormService {
	static name = 'form';

	apiRoutes(app, server) {
		server.get("/.api/form", () => {
			throw new HttpError.MethodNotAllowed("Only post allowed");
		});
		server.post("/.api/form/:id", async (req, res) => {
			const data = await req.run('form.submit', {
				id: req.params.id,
				query: req.query,
				body: unflatten(req.body)
			});
			res.return(data);
		});
	}

	async submit({ site, run, user, locked }, data) {
		const form = await run('block.get', {
			id: data.id
		});

		const fd = form.data || {};
		const method = (fd.action || {}).method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}
		if (locked((form.lock || {}).write)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}
		let body = data.body;
		// build parameters
		const expr = ((form.expr || {}).action || {}).parameters || {};
		let params = mergeParameters(expr, {
			$request: body,
			$query: data.query || {},
			$user: user
		});
		params = mergeExpressions(params, fd.action.parameters);

		Log.api("form params", params, user, data.query);

		// build body
		if (params.type && Array.isArray(params.type) == false && Object.keys(body).length > 0) {
			const el = site.$schema(params.type);
			if (!el) {
				throw new HttpError.BadRequest("Unknown element type " + params.type);
			}
			const newBody = { data: {} };
			for (const key of Object.keys((el.properties.data || {}).properties || {})) {
				const val = body[key];
				if (val !== undefined) {
					newBody.data[key] = val;
					delete body[key];
				}
			}
			for (const key of Object.keys(el.properties)) {
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
			}
			body = newBody;
		}
		body = mergeExpressions(body, params);

		return run(method, body).catch((err) => {
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
	}
	static submit = {
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
};
