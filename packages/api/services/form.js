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
		var api = fd.action.call.split('.');
		return All.run(fd.action.call, data).then(function(response) {
			if (!fd.reaction.call || fd.reaction.method != "post") return response;
			// process fd.reaction.data
			var rdata = {};
			Object.keys(fd.reaction.data || {}).forEach(function(key) {
				var path = fd.reaction.data[key];
				var val = accessKey(path, {req: data, res:response});
				if (val === undefined) val = path;
				rdata[key] = val;
			});
			rdata.domain = data.domain;
			return All.run(fd.reaction.call, rdata);
		}).then(function() {
			var result = {};
			if (fd.redirect) {
				result.redirect = fd.redirect;
			}
			return result;
		});
	});
};

function accessKey(path, data) {
	var val = data;
	path.split('.').forEach(function(key) {
		if (val == null) return;
		val = val[key];
	});
	return val;
}
