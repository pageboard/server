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
	}).then(function(form) {
		var fd = form.data;
		if (fd.action.method != "post") throw new HttpError.MethodNotAllowed("Only post allowed");
		return All.run(fd.action.call, data).then(function(response) {
			if (fd.redirection && fd.redirection.url) {
				// TODO build redirection using fd.redirection.url, consts, vars
				response.redirect = fd.redirection.url;
			}
			return response;
		});
	});
};

