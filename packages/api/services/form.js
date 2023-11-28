const {
	mergeExpressions,
	unflatten
} = require('../../../src/utils');

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

	async submit({ site, run, user, locked, trx, ref }, data) {
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
				$site: site.id,
				$user: user
			}
		);

		Log.api("form params", params, user, data.query);

		return run(method, params);
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
