exports = module.exports = function(opt) {
	return {
		name: 'form',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/form", function(req, res, next) {
		next(new HttpError.MethodNotAllowed("Only post allowed"));
	});
	All.app.post("/.api/form/:id", function(req, res, next) {
		All.run('form.submit', req.site, {
			id: req.params.id,
			query: All.utils.unflatten(req.query),
			body: All.utils.unflatten(req.body)
		}).then(function(data) {
			res.json(data);
		}).catch(next);
	});
}

exports.submit = function(site, data) {
	return All.run('block.get', site, {
		id: data.id
	}).then(function(form) {
		var fd = form.data || {};
		if (!fd.method) throw new HttpError.BadRequest("Missing method");
		var params = All.utils.mergeParameters(fd.parameters, {
			$query: data.query,
			$body: data.body
		});
		if (fd.type) {
			if (Object.keys(data.body).length > 0) params.data = data.body;
			params.type = fd.type;
		}
		return All.run(fd.method, site, params);
	});
};

exports.submit.schema = {
	$action: 'write',
	required: ["id"],
	properties: {
		id: {
			type: 'string',
			format: 'id'
		},
		query: {
			type: 'object'
		},
		body: {
			type: 'object'
		}
	},
	additionalProperties: false
};

