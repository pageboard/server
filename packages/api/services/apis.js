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
		router.write(["/:name", "/form/:name"], async req => {
			await req.run('upload.parse', {});

			return req.run('apis.post', {
				name: req.params.name,
				query: unflatten(req.query),
				body: unflatten(req.body)
			});
		});
	}

	siteRoutes(router) {
		router.get("/@stream/:name", async (req, res, next) => {
			const data = req.params;
			const form = await req.run('apis.find', {
				name: data.name,
				types: ['fetch']
			});

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
			const pingInterval = setInterval(() => {
				res.write(`data: {"type":"ping"}\n\n`);
			}, 25000);
			req.on('close', () => {
				clearInterval(pingInterval);
				for (const writer of reactions) {
					// TODO when fetch.data.reactions is changed
					// it must unregister its readers from each of the previous reactions
					// reactions should be a relation between fetch/form
					const readers = wMap.get(writer);
					readers?.delete(res);
				}
			});
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Connection': 'keep-alive',
				'Cache-Control': 'no-cache',
				'X-Accel-Buffering': 'no'
			});
		});
	}

	async post(req, data) {
		const { site, user, locked } = req;
		const form = await req.run('apis.find', {
			name: data.name,
			types: ['api_form']
		});

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
			$origin: req.$url.origin,
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

		const response = method ? req.filter(
			await req.run(method, input)
		) : input;

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
					reader.write(`data: {"type":"write"}\n\n`);
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
		const { site, user, locked } = req;
		const form = await req.run('apis.find', {
			name: data.name,
			types: ['fetch', 'mail_fetch']
		});
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
			$origin: req.$url.origin,
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

		const response = method ? req.filter(
			await req.run(method, input)
		) : input;

		const out = Object.isEmpty(action.response)
			? response
			: mergeExpressions(
				response,
				unflatten(action.response),
				scope
			);
		if (data.hrefs && out && typeof out == "object" && !Array.isArray(out) && response.hrefs) {
			out.hrefs = response.hrefs;
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

	async #redirect(req, redirection, response, scope) {
		redirection = mergeExpressions(response, redirection ?? {}, scope);
		if (scope.$out && redirection?.name) {
			const api = await req.run('apis.find', {
				name: redirection.name,
				types: ['api_form', 'fetch']
			});
			if (api.type == 'api_form') {
				if (redirection.grant && !req.user.grants.includes(redirection.grant)) {
					req.user.grants.push(redirection.grant);
				}
				return req.run('apis.post', {
					name: redirection.name,
					query: redirection.parameters,
					body: scope.$out
				});
			} else {
				return req.run('apis.get', {
					name: redirection.name,
					query: redirection.parameters
				});
			}
		} else {
			return scope.$out;
		}
	}

	find({ site, sql: { ref, trx } }, { name, types }) {
		return site.$relatedQuery('children', trx)
			.whereIn('block.type', types)
			.where(q => {
				q.where('block.id', name);
				q.orWhere(ref('block.data:name').castText(), name);
			})
			.first().throwIfNotFound({
				message: `No ${types.join(', ')} matching id or data.name: ${name}`
			});
	}
	static find = {
		$private: true,
		$action: 'read'
	};
};

