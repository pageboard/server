exports = module.exports = function(opt) {
	return {
		name: 'search',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/query/:id", function(req, res, next) {
		All.run('search.query', req.site, {
			id: req.params.id,
			query: All.utils.unflatten(req.query)
		}).then(function(data) {
			All.send(data);
		}).catch(next);
	});
	All.app.post("/.api/query", function(req, res, next) {
		next(new HttpError.NotImplemented());
	});
}

exports.query = function(site, data) {
	return All.run('block.get', site, {
		id: data.id
	}).then(function(form) {
		var fd = form.data || {};
		var method = fd.action.method;
		if (!method) throw new HttpError.BadRequest("Missing method");
		var params = All.utils.mergeObjects(data.query, fd.action.parameters);
		return All.run(method, site, params);
	});
};

exports.query.schema = {
	$action: 'read',
	required: ['id'],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		query: {
			type: 'object'
		}
	},
	additionalProperties: false
};

