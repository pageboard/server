const {
	mergeRecursive,
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

		const method = form.data?.action?.method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}
		if (locked(form.lock?.write)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}

		const params = mergeExpressions(
			form.data?.action?.parameters ?? {},
			form.expr?.action?.parameters ?? {},
			{
				$request: data.body,
				$query: data.query || {},
				$user: user
			}
		);

		Log.api("form params", params, user, data.query);

		// allow body keys as block.data
		const body = {};
		if (params.type && Array.isArray(params.type) == false && Object.keys(data.body).length > 0) {
			const el = site.$schema(params.type);
			if (!el) {
				throw new HttpError.BadRequest("Unknown element type " + params.type);
			}
			body.data = {};
			for (const key of Object.keys(el.properties.data?.properties ?? {})) {
				const val = data.body[key];
				if (val !== undefined) {
					body.data[key] = val;
					delete data.body[key];
				}
			}
			// this should be removed - only expressions should be used to achieve this
			for (const key of Object.keys(el.properties)) {
				const mkey = '$' + key;
				const mval = data.body[mkey];
				if (mval !== undefined) {
					body[key] = mval;
				} else {
					const val = data.body[key];
					if (val !== undefined) {
						console.warn(`Use $${key} for setting el.properties[key]`);
						body[key] = val;
					}
				}
			}
		}
		mergeRecursive(body, params);

		return run(method, body).catch((err) => {
			return {
				status: err.statusCode || err.status || err.code || 400,
				item: {
					type: 'error',
					data: err.data ?? {
						method: err.method ?? method,
						messages: err.message
					},
					content: err.content ?? err.toString()
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
