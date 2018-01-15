exports = module.exports = function(opt) {
	return {
		name: 'form',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/form", All.query, function(req, res, next) {
		exports.query(req.query).then(function(data) {
			res.json(data);
		}).catch(next);
	});
	All.app.post("/.api/form", All.body, function(req, res, next) {
		exports.submit(req.body).then(function(data) {
			if (data.redirect && req.accepts('html') && !req.xhr) {
				res.location(data.redirect);
			}	else {
				res.json(data);
			}
		}).catch(next);
	});
}

exports.query = function(data) {
	return All.block.get({
		id: data._parent,
		domain: data.domain
	}).then(function(form) {
		var type = form.data.action.consts.type;
		if (!type) throw new HttpError.BadRequest("Missing form action.consts.type");
		return All.block.get({
			id: data.id,
			type: type,
			domain: data.domain
		});
	});
};

exports.submit = function(data) {
	return All.block.get({
		id: data._parent,
		domain: data.domain
	}).then(function(form) {
		var fd = form.data;
		if (fd.action.method != "post") throw new HttpError.MethodNotAllowed("Only post allowed");
		// TODO:
		// - if fd.schema is set, validate against that custom schema
		// - a helper that builds data.schema out of current form input content
		// - this is crucial because it filters out unwanted data
		// action.call block.add, block.save...
		// TODO how a query element can populate a form ? it's crucial so that
		// shopmaster can modify a product in database

		// TODO vars should either be replaced by schema validation or at least populated with a mapping
		// schema validation could be done through form.data.type ?
		var params = {};
		for (var k in data) All.search.setVar(params, k, data[k]);
		delete params._parent;
		if (fd.action.type) {
			// when bound to an element, all keys are supposed to be in block.data
			params = {data: params};
		}
		var consts = fd.action.consts;
		if (consts) Object.keys(consts).forEach(function(key) {
			All.search.setVar(params, key, consts[key]);
		});

		return All.run(fd.action.call, params).then(function(response) {
			if (fd.redirection && fd.redirection.url) {
				// TODO build redirection using fd.redirection.url, consts, vars
				response.redirect = fd.redirection.url;
			}
			return response;
		});
	});
};

