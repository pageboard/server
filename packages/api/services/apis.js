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
		const { method, parameters = {} } = action;
		const { query = {}, body = {} } = data;
		const scope = {};

		for (const key of Object.keys(parameters)) {
			if (parameters[key] === null) delete parameters[key];
		}
		for (const [key, val] of Object.entries(query)) {
			if (["$lang", "$pathname"].includes(key)) {
				scope[key] = val;
				delete query[key];
			}
		}
		// overwrite to avoid injection
		Object.assign(scope, {
			$request: body,
			$query: query,
			$origin: site.$url.origin,
			$site: site.id,
			$languages: site.data.languages,
			$user: user
		});

		const input = scope.$in = Object.isEmpty(action.request)
			? mergeRecursive(body, parameters)
			: mergeExpressions(
				parameters,
				mergeRecursive({}, parameters, unflatten(action.request)),
				scope
			);

		const response = method ? await run(method, input) : input;

		scope.$out = Object.isEmpty(action.response)
			? response
			: mergeExpressions(
				response,
				unflatten(action.response),
				scope
			);

		if (data.name) {
			const writers = this.#writers.get(data.name);
			if (writers?.size) req.finish(() => {
				for (const reader of writers) {
					reader.write(`data: ${JSON.stringify({})}\n\n`);
				}
			});
		}
		return this.#redirect(req, form.data.redirection, response, scope);
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
		const { method, parameters = {} } = action;
		const { query = {} } = data;
		const scope = {};

		for (const key of Object.keys(parameters)) {
			if (parameters[key] === null) delete parameters[key];
		}
		for (const [key, val] of Object.entries(query)) {
			if (["$lang", "$pathname"].includes(key)) {
				scope[key] = val;
				delete query[key];
			}
		}
		// overwrite to avoid injection
		Object.assign(scope, {
			$query: query,
			$origin: site.$url.origin,
			$site: site.id,
			$languages: site.data.languages,
			$user: user
		});

		const input = scope.$in = Object.isEmpty(action.request)
			? mergeRecursive(query, parameters)
			: mergeExpressions(
				parameters,
				mergeRecursive({}, parameters, unflatten(action.request)),
				scope
			);

		const response = method ? await run(method, input) : input;

		const out = Object.isEmpty(action.response)
			? response
			: mergeExpressions(
				response,
				unflatten(action.response),
				scope
			);
		if (data.hrefs && out && typeof out == "object" && !Array.isArray(out)) {
			out.hrefs = data.hrefs;
		}
		return out;
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

	async #redirect({ site, run, sql: { ref, trx } }, redirection, response, scope) {
		redirection = mergeExpressions(response, redirection, scope);
		if (redirection.name) {
			const api = await site.$relatedQuery('children', trx)
				.select('type')
				.whereIn('block.type', ['api_form', 'fetch'])
				.where(ref('block.data:name').castText(), redirection.name)
				.first();
			if (!api) throw new HttpError.NotFound("Redirection not found: " + redirection.name);

			if (api.type == 'api_form') {
				return run('apis.post', {
					name: redirection.name,
					query: redirection.parameters,
					body: scope.$out
				});
			} else {
				return run('apis.get', {
					name: redirection.name,
					query: redirection.parameters
				});
			}
		} else {
			return scope.$out;
		}
	}
};

