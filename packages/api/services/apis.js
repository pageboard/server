const { mergeExpressions, unflatten, mergeRecursive } = require('../../../src/utils');

module.exports = class ApiService {
	static name = 'apis';
	static priority = 1000;

	apiRoutes(app) {
		// these routes are setup after all others
		// eventually all routes will be declared as actions ?
		app.get(["/@api/:id", "/@api/query/:id"], req => {
			return req.run('apis.get', {
				id: req.params.id,
				query: unflatten(req.query)
			});
		});
		app.post(["/@api/:id", "/@api/form/:id"], req => {
			// TODO process multipart form data to upload files
			// body[name] must become the relative URL of the uploaded file
			// however, since we don't know the input_file block,
			// we can't use to configure that upload (set limits, file type, etc...)
			// Inputs should be affiliated to their forms - forms should always be standalone,
			// however standalones are buggy and dangerous to use when they are in a page
			// so stabilizing standalones should be a priority
			return req.run('apis.post', {
				id: req.params.id,
				query: unflatten(req.query),
				body: unflatten(req.body)
			});
		});
	}

	async post(req, data) {
		const { site, run, user, locked, trx, ref } = req;
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

		const { action = {} } = form.data ?? {};

		const { method } = action;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}

		const reqBody = data.body ?? {};

		const formData = action.parameters ?? {};
		for (const key of Object.keys(formData)) {
			// else mergeRecursive(body, params) will drop everything
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
			$query: query,
			$site: site.id,
			$user: user
		});

		const params = mergeExpressions(
			action.parameters ?? {},
			mergeRecursive({}, action.parameters, action.request),
			scope
		);

		const obj = await run(method, params);

		if (Object.isEmpty(action.response)) return obj;
		else return mergeExpressions({}, action.response, obj);

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

	async get({ site, run, user, locked, trx, ref }, data) {
		const form = await site.$relatedQuery('children', trx)
			.where('block.id', data.id)
			.orWhere(q => {
				q.where('block.type', 'fetch');
				q.where(ref('block.data:name').castText(), data.id);
			})
			.orderBy('id')
			.first().throwIfNotFound();
		if (locked(form.lock)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}

		const { action = {} } = form.data ?? {};

		const { method } = action;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
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
			$query: query,
			$site: site.id,
			$user: user
		});

		const params = mergeExpressions(
			action.parameters ?? {},
			mergeRecursive({}, action.parameters, action.request),
			scope
		);

		const obj = await run(method, params);

		if (Object.isEmpty(action.response)) return obj;
		else return mergeExpressions(obj, action.response, scope);
	}
	static get = {
		title: 'API Get',
		$private: true,
		$action: 'read',
		$tags: ['data-:site'],
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
		}
	};
};

