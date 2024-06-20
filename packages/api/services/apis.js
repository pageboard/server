const { mergeExpressions, unflatten, mergeRecursive } = require('../../../src/utils');

module.exports = class ApiService {
	static name = 'apis';
	static priority = 1000;

	apiRoutes(app) {
		// these routes are setup after all others
		// eventually all routes will be declared as actions ?
		app.get(["/@api/:name", "/@api/query/:name"], req => {
			return req.run('apis.get', {
				name: req.params.name,
				query: unflatten(req.query)
			});
		});
		app.post(["/@api/:name", "/@api/form/:name"], req => {
			// TODO process multipart form data to upload files
			// body[name] must become the relative URL of the uploaded file
			// however, since we don't know the input_file block,
			// we can't use to configure that upload (set limits, file type, etc...)
			// Inputs should be affiliated to their forms - forms should always be standalone,
			// however standalones are buggy and dangerous to use when they are in a page
			// so stabilizing standalones should be a priority
			return req.run('apis.post', {
				name: req.params.name,
				query: unflatten(req.query),
				body: unflatten(req.body)
			});
		});
	}

	async post(req, data) {
		const { site, run, user, locked, trx, ref } = req;
		const form = await site.$relatedQuery('children', trx)
			.where('block.type', 'api_form')
			.where(q => {
				q.where('block.id', data.name);
				q.orWhere(ref('block.data:name').castText(), data.name);
			})
			.first().throwIfNotFound();
		if (locked(form.lock)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}

		const { action = {}, redirection } = form.data ?? {};

		const { method } = action;

		const reqBody = data.body ?? {};

		const formData = action.parameters ?? {};
		for (const key of Object.keys(formData)) {
			if (formData[key] === null) delete formData[key];
		}

		const { query = {} } = data;
		const scope = {};

		for (const [key, val] of Object.entries(query)) {
			if (key.startsWith('$')) {
				// allows client to pass $pathname $lang and others
				scope[key] = val;
				delete query[key];
			}
		}
		// overwrite to avoid injection
		Object.assign(scope, {
			$request: reqBody ?? {},
			$lang: req.call('translate.lang', data).lang,
			$origin: site.$url.origin,
			$query: query,
			$site: site.id,
			$user: user
		});

		const params = mergeExpressions(
			action.parameters ?? {},
			mergeRecursive({}, action.parameters, unflatten(action.request)),
			scope
		);

		const response = method ? await run(method, params) : params;

		const result = Object.isEmpty(action.response)
			? response
			: mergeExpressions(response, unflatten(action.response), scope);

		const { api, name } = /^\/@api\/(?<api>query|form)\/(?<name>[^/]+)$/
			.exec(redirection?.url)?.groups ?? {};

		if (api && name) {
			// TODO prevent recursion
			const method = { query: "apis.get", form: "apis.post" }[api];
			// FIXME: if form is redirecting to fetch,
			// the form response must be fed into the query
			// by the redirection.url/parameters
			scope.$response = result;
			const redirParams = mergeExpressions({}, redirection.parameters, scope);
			const opts = {
				name,
				query: redirParams
			};
			if (method == "form") opts.body = result;
			return run(method, opts);
		} else {
			return result;
		}
		// if (schema.templates) {
		// 	block.expr = mergeExpressions(block.expr ?? {}, schema.templates, block);
		// 	if (Object.isEmpty(block.expr)) block.expr = null;
		// }
	}
	static post = {
		title: 'API Post',
		$private: true,
		$action: 'write',
		$tags: ['data-:site'],
		required: ["name"],
		properties: {
			name: {
				type: 'string',
				format: 'name'
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

	async get(req, data) {
		const { site, run, user, locked, trx, ref } = req;
		const form = await site.$relatedQuery('children', trx)
			.where('block.type', 'fetch')
			.where(q => {
				q.where('block.id', data.name);
				q.orWhere(ref('block.data:name').castText(), data.name);
			})
			.first().throwIfNotFound();
		if (locked(form.lock)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}

		const { action = {} } = form.data ?? {};

		const { method } = action;

		const { query = {} } = data;
		const scope = {};

		for (const [key, val] of Object.entries(query)) {
			if (key.startsWith('$')) {
				// allows client to pass $pathname $lang and others
				scope[key] = val;
				delete query[key];
			}
		}
		// overwrite to avoid injection
		Object.assign(scope, {
			$lang: req.call('translate.lang', data).lang,
			$origin: site.$url.origin,
			$query: query,
			$site: site.id,
			$user: user
		});
		const params = mergeExpressions(
			action.parameters ?? {},
			mergeRecursive({}, action.parameters, unflatten(action.request)),
			scope
		);

		const response = method ? await run(method, params) : params;

		const result = Object.isEmpty(action.response)
			? response
			: mergeExpressions(response ?? {}, unflatten(action.response), scope);

		if (data.hrefs) return {
			items: result,
			hrefs: response.hrefs
		};
		else return result;
	}
	static get = {
		title: 'API Get',
		$private: true,
		$action: 'read',
		$tags: ['data-:site'],
		required: ['name'],
		properties: {
			name: {
				type: 'string',
				format: 'name'
			},
			query: {
				type: 'object',
				nullable: true
			},
			hrefs: {
				type: 'boolean',
				description: 'metadata for hrefs',
				default: false
			}
		}
	};
};

