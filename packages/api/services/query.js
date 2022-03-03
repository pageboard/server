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

	async query(req, data) {
		const { site } = req;
		const form = await req.run('block.get', {
			id: data.id
		});
		const fd = form.data || {};
		const method = (fd.action || {}).method;
		if (!method) {
			throw new HttpError.BadRequest("Missing method");
		}
		if (req.locked((form.lock || {}).read)) {
			throw new HttpError.Unauthorized("Check user permissions");
		}
		// build parameters
		const expr = ((form.expr || {}).action || {}).parameters || {};
		let params = this.app.utils.mergeParameters(expr, {
			$query: data.query || {},
			$user: req.user
		});
		params = this.app.utils.mergeExpressions(params, fd.action.parameters);
		try {
			const obj = await req.run(method, params);
			// check if a non-page bundle is needed
			const bundles = {};
			Object.keys(site.$bundles).forEach(key => {
				const bundle = site.$bundles[key];
				if (bundle.meta.group != "page") bundles[key] = bundle;
			});
			const metas = {};
			Object.keys(fillTypes(obj.item || obj.items, {})).forEach((type) => {
				const bundleType = Object.keys(bundles).find((key) => {
					return bundles[key].elements.includes(type);
				});
				if (bundleType) {
					metas[bundleType] = bundles[bundleType].meta;
				}
			});
			obj.metas = Object.values(metas);
			return obj;
		} catch(err) {
			return {
				status: err.statusCode || err.status || err.code || 400,
				item: {
					type: 'error',
					data: {
						message: err.message
					}
				}
			};
		}
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
		},
		additionalProperties: false
	};
};

function fillTypes(list, obj) {
	if (!list) return obj;
	if (!Array.isArray(list)) list = [list];
	for (const row of list) {
		if (row.type) obj[row.type] = true;
		if (row.parent) fillTypes(row.parent, obj);
		if (row.child) fillTypes(row.child, obj);
		if (row.parents) fillTypes(row.parents, obj);
		if (row.children) fillTypes(row.children, obj);
	}
	return obj;
}
