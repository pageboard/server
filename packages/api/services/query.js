var lodashMerge = require('lodash.merge');

exports = module.exports = function(opt) {
	return {
		name: 'search',
		service: init
	};
};

/*
- form.get
- builds a url query
- opens a page
- the page contains a query block
- the query block requests the query api to return blocks
- the query block renders the blocks into its virtual content
*/

function init(All) {
	All.app.get("/.api/query", function(req, res, next) {
		All.run('search.query', req.site, req.query).then(function(data) {
			res.json(data);
		}).catch(next);
	});
	All.app.post("/.api/query", function(req, res, next) {
		throw new HttpError.NotImplemented();
	});
}

exports.query = function(site, data) {
	return All.run('block.get', site, {
		id: data._id
	}).then(function(parent) {
		var fd = parent.data.query || {};
		if (!fd.call) throw new HttpError.BadRequest("Missing query.call");
		delete data._id;
		var params = {};
		// consts: destPath: val
		// vars: destPath: queryPath
		// allow rewriting variables
		var copy = lodashMerge({}, data);
		if (fd.vars) Object.keys(fd.vars).forEach(function(key) {
			var varName = fd.vars[key];
			if (!varName) return;
			varName = varName.split('|').shift();
			var val = getVar(data, varName);
			if (val === undefined) return;
			setVar(copy, varName); // problem, it removes the variables but might need it later...
			setVar(params, key, val);
		});
		if (fd.type) {
			params.type = fd.type;
			if (Object.keys(copy).length > 0) {
				params.data = copy;
			}
		}
		// overwriting values
		if (fd.consts) Object.keys(fd.consts).forEach(function(key) {
			setVar(params, key, fd.consts[key]);
		});

		return All.run(fd.call, site, params);
	});
};

exports.getVar = getVar;
function getVar(obj, path) {
	var list = path.split('.');
	var name;
	for (var i=0; i < list.length; i++) {
		name = list[i];
		if (obj[name] == null) return;
		obj = obj[name];
	}
	return obj;
}

exports.setVar = setVar;
function setVar(obj, path, val) {
	var list = path.split('.');
	var last = list.pop();
	var name;
	for (var i=0; i < list.length; i++) {
		name = list[i];
		if (obj[name] == null) obj[name] = {};
		obj = obj[name];
	}
	if (val === undefined) delete obj[last];
	else obj[last] = val;
}

