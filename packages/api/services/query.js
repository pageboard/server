const {
	mergeExpressions, unflatten
} = require('../../../src/utils');

module.exports = class SearchService {
	static name = 'search';

	constructor(app) {
		this.app = app;
	}

	apiRoutes(app, server) {
		server.get("/.api/query/:id", async (req, res) => {
			const data = await req.run('search.query', {
				id: req.params.id,
				query: req.query
			});
			res.return(data);
		});
		server.post("/.api/query", (req, res, next) => {
			next(new HttpError.NotImplemented());
		});
	}

	async query({ site, run, user, locked, trx, ref }, data) {
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

		const method = form.data?.action?.method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}
		const query = unflatten(data.query ?? {});
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
			form.data?.action?.parameters ?? {},
			form.expr?.action?.parameters ?? {},
			scope
		);

		return run(method, params);
	}
	static query = {
		title: 'Form query',
		$lock: true,
		$action: 'read',
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

