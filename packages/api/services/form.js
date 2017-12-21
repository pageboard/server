exports = module.exports = function(opt) {
	return {
		name: 'form',
		service: init
	};
};

function init(All) {
	All.app.get("/.api/form", function(req, res, next) {
		throw new HttpError.NotImplemented();
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

exports.submit = function(data) {
	return All.block.get({
		id: data.parent,
		domain: data.domain
	}).then(function(parent) {
		var fd = parent.data;
		if (fd.action.method != "post") throw new HttpError.MethodNotAllowed("Only post allowed");
		var params = Object.assign({}, data);
		delete data.parent;
		mapVars(params, fd.action.vars);
		Object.assign(params, fd.action.consts);

		return All.run(fd.action.call, params).then(function(response) {
			if (fd.redirection && fd.redirection.url) {
				// TODO build redirection using fd.redirection.url, consts, vars
				response.redirect = fd.redirection.url;
			}
			return response;
		});
	});
};

function mapVars(params, vars) {
	if (vars) Object.keys(vars).forEach(function(key) {
		var val = params[key];
		if (val !== undefined) {
			delete params[key];
			params[vars[key]] = val;
		}
	});
}

