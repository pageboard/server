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
		var type = (form.data.action || {}).type;
		if (!type) throw new HttpError.BadRequest("Missing form action.type");
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
		var fd = form.data.action || {};
		if (fd.method != "post") throw new HttpError.MethodNotAllowed("Only post allowed");
		var domain = data.domain;
		delete data.domain;
		delete data._parent;

		var setVar = All.search.setVar;
		var getVar = All.search.getVar;
		var params = {}; // TODO import data using fd.type schema
		Object.keys(data).forEach(function(key) {
			setVar(params, key, data[key]);
		});
		if (fd.vars) Object.keys(fd.vars).forEach(function(key) {
			var val = getVar(data, fd.vars[key]);
			if (val === undefined) return;
			setVar(params, key, val);
		});
		if (fd.type) {
			// when bound to an element, all keys are supposed to be in block.data
			var id = params._id;
			delete params._id;
			params = {
				type: fd.type,
				data: params
			};
			if (id) params.id = id;
		}
		// overwriting values
		if (fd.consts) Object.keys(fd.consts).forEach(function(key) {
			setVar(params, key, fd.consts[key]);
		});

		params.domain = domain;
		return All.run(fd.call, params).then(function(response) {
			if (typeof response != "obj") response = {};
			var redirect = form.data.redirection && form.data.redirection.url;
			if (redirect) {
				// TODO build redirection using fd.redirection.url, consts, vars
				response.redirect = redirect;
			}
			return response;
		});
	});
};

