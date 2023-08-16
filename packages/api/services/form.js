const {
	mergeRecursive,
	mergeExpressions,
	unflatten
} = require('../../../src/utils');

const { ref } = require('objection');

module.exports = class FormService {
	static name = 'form';

	apiRoutes(app, server) {
		server.get("/.api/form", () => {
			throw new HttpError.MethodNotAllowed("Only post allowed");
		});
		server.post("/.api/form/:id", app.cache.tag('data-:site'), async (req, res) => {
			const data = await req.run('form.submit', {
				id: req.params.id,
				query: req.query,
				body: unflatten(req.body)
			});
			res.return(data);
		});
	}

	async submit({ site, run, user, locked, trx }, data) {
		const form = await site.$relatedQuery('children', trx)
			.where('block.id', data.id)
			.orWhere(q => {
				q.where('block.type', 'api_form');
				q.where(ref('block.data:name').castText(), data.id);
			})
			.orderBy('id')
			.first().throwIfNotFound();
		if (locked(form.lock)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}

		const reqBody = data.body ?? {};

		const method = form.data?.action?.method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}

		const formData = form.data?.action?.parameters ?? {};
		for (const key of Object.keys(formData)) {
			// else mergeRecursive(body, params) will drop everything
			if (formData[key] === null) delete formData[key];
		}

		const params = mergeExpressions(
			form.data?.action?.parameters ?? {},
			form.expr?.action?.parameters ?? {},
			{
				$request: reqBody ?? {},
				$query: unflatten(data.query ?? {}),
				$site: site.data,
				$user: user
			}
		);

		Log.api("form params", params, user, data.query);

		const body = {};

		if (params.type && Array.isArray(params.type) == false && !(reqBody.data && reqBody.id) && Object.keys(reqBody).length > 0) {
			// TODO remove this whole thing
			const el = site.$schema(params.type);
			if (!el) {
				throw new HttpError.BadRequest("Unknown element type " + params.type);
			}
			body.data = {};
			for (const key of Object.keys(el.properties.data?.properties ?? {})) {
				const val = reqBody[key];
				if (val !== undefined) {
					mergeRecursive(body.data, { [key]: val });
					delete reqBody[key];
				}
			}
			// this should be removed - only expressions should be used to achieve this
			for (const key of Object.keys(el.properties)) {
				const mkey = '$' + key;
				const mval = reqBody[mkey];
				if (mval !== undefined) {
					body[key] = mval;
				} else {
					const val = reqBody[key];
					if (val !== undefined) {
						console.warn(`Use $${key} for setting el.properties[key]`);
						body[key] = val;
					}
				}
			}
		} else {
			Object.assign(body, reqBody);
		}
		mergeRecursive(body, params);

		return run(method, body);
	}
	static submit = {
		title: 'Form submit',
		$lock: true,
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
