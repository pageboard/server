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

	async query({ site, run, locked, user }, data) {
		const form = await run('block.get', {
			id: data.id
		});

		const method = form.data?.action?.method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}
		if (locked(form.lock?.read)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}
		const { $pathname } = data.query;
		delete data.query.$pathname;
		const params = mergeExpressions(
			form.data?.action?.parameters ?? {},
			form.expr?.action?.parameters ?? {},
			{
				$pathname,
				$query: unflatten(data.query || {}),
				$user: user
			}
		);

		return run(method, params);
	}
	static query = {
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

