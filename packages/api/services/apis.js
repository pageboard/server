const { mergeExpressions, unflatten, mergeRecursive } = require('../../../src/utils');

module.exports = class ApiService {
	static name = 'apis';
	static priority = 1000;

	#writers = new Map();

	apiRoutes(router) {
		router.read(["/:name", "/query/:name"], req => {
			return req.run('apis.get', {
				name: req.params.name,
				query: unflatten(req.query)
			});
		});
		router.write(["/:name", "/form/:name"], async (req, body) => {
			await req.run('upload.parse', {});

			return req.run('apis.post', {
				name: req.params.name,
				body: unflatten(body)
			});
		});
		router.get("/stream/:name", async (req, res, next) => {
			const data = req.params;
			try {
				const form = await req.run(
					({ site, sql: { ref, trx } }) => site.$relatedQuery('children', trx)
						.whereIn('block.type', ['fetch', 'mail_fetch'])
						.where(q => {
							q.where('block.id', data.name);
							q.orWhere(ref('block.data:name').castText(), data.name);
						})
						.first().throwIfNotFound()
				);

				const { reactions = [] } = form.data ?? {};

				if (!reactions.length) {
					throw new HttpError.BadRequest("No reactions");
				}
				const wMap = this.#writers;
				for (const writer of reactions) {
					const readers = (
						wMap.has(writer) ? wMap : wMap.set(writer, new Set())
					).get(writer);
					readers.add(res);
				}
				req.on('close', () => {
					for (const writer of reactions) {
						const readers = wMap.get(writer);
						readers?.delete(res);
					}
				});
				res.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Connection': 'keep-alive',
					'Cache-Control': 'no-cache'
				});
			} catch (err) {
				next(err);
			}
		});
	}

	async post(req, data) {
		const { site, run, user, locked, sql: { ref, trx } } = req;
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

		const { action = {} } = form.data ?? {};

		const { method } = action;

		const reqBody = data.body ?? {};

		const fields = action.parameters ?? {};
		for (const key of Object.keys(fields)) {
			if (fields[key] === null) delete fields[key];
		}

		const { query = {} } = data;
		const scope = {};

		for (const [key, val] of Object.entries(query)) {
			if (["$lang", "$pathname"].includes(key)) {
				scope[key] = val;
				delete query[key];
			}
		}
		// overwrite to avoid injection
		Object.assign(scope, {
			$request: reqBody ?? {},
			$origin: site.$url.origin,
			$query: query,
			$site: site.id,
			$languages: site.data.languages,
			$user: user
		});

		const params = Object.isEmpty(action.request)
			? mergeRecursive(reqBody, fields)
			: mergeExpressions(fields,
				mergeRecursive({}, fields, unflatten(action.request)),
				scope
			);

		const response = method ? await run(method, params) : params;

		const result = Object.isEmpty(action.response)
			? response
			: mergeExpressions(
				response,
				unflatten(action.response),
				scope
			);

		scope.$response = result;
		const redirection = mergeExpressions(params, form.data.redirection, scope);
		if (data.name) {
			const writers = this.#writers.get(data.name);
			if (writers?.size) req.finish(() => {
				for (const reader of writers) {
					reader.write(`data: ${JSON.stringify({})}\n\n`);
				}
			});
		}
		return this.#redirect(req, redirection, result);
		// if (schema.templates) {
		// 	block.expr = mergeExpressions(block.expr ?? {}, schema.templates, block);
		// 	if (Object.isEmpty(block.expr)) block.expr = null;
		// }
	}
	static post = {
		title: 'Post',
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
		const { site, run, user, locked, sql: { trx, ref } } = req;
		const form = await site.$relatedQuery('children', trx)
			.whereIn('block.type', ['fetch', 'mail_fetch'])
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

		const fields = action.parameters ?? {};
		for (const key of Object.keys(fields)) {
			if (fields[key] === null) delete fields[key];
		}

		const { query = {} } = data;

		const scope = {};

		for (const [key, val] of Object.entries(query)) {
			if (["$lang", "$pathname"].includes(key)) {
				scope[key] = val;
				delete query[key];
			}
		}
		// overwrite to avoid injection
		Object.assign(scope, {
			$origin: site.$url.origin,
			$query: query,
			$site: site.id,
			$languages: site.data.languages,
			$user: user
		});

		const params = Object.isEmpty(action.request)
			? mergeRecursive(query, fields)
			: mergeExpressions(fields,
				mergeRecursive({}, fields, unflatten(action.request)),
				scope
			);

		const response = method ? await run(method, params) : params;

		const result = Object.isEmpty(action.response)
			? response
			: mergeExpressions(
				response,
				unflatten(action.response),
				scope
			);
		if (data.hrefs && result && typeof result == "object" && !Array.isArray(result)) {
			result.hrefs = data.hrefs;
		}
		return result;
	}
	static get = {
		title: 'Get',
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

	async #redirect({ site, run, sql: { ref, trx } }, redirection, result) {
		if (redirection.name) {
			const api = await site.$relatedQuery('children', trx)
				.select('type')
				.whereIn('block.type', ['api_form', 'fetch'])
				.where(ref('block.data:name').castText(), redirection.name)
				.first().throwIfNotFound();

			if (api.type == 'api_form') {
				return run('apis.post', {
					name: redirection.name,
					query: redirection.parameters,
					body: result
				});
			} else {
				return run('apis.get', {
					name: redirection.name,
					query: redirection.parameters
				});
			}
		} else {
			return result;
		}
	}
};

