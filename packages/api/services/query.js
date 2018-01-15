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
	All.app.get("/.api/query", All.query, function(req, res, next) {
		exports.query(req.query).then(function(data) {
			res.json(data);
		}).catch(next);
	});
	All.app.post("/.api/query", function(req, res, next) {
		throw new HttpError.NotImplemented();
	});
}

exports.query = function(data) {
	return All.block.get({
		id: data._parent,
		domain: data.domain
	}).then(function(parent) {
		var fd = parent.data.query || {};
		var params = mapData(data, fd.consts, fd.vars);
		params.domain = data.domain;
		return All.run(fd.call, params);
	});
};

// consts: destPath: val
// vars: destPath: queryPath
function mapData(data, consts, vars) {
	var out = {};
	if (vars) Object.keys(vars).forEach(function(key) {
		var val = getVar(data, vars[key]);
		if (val === undefined) return;
		setVar(out, key, val);
	});
	if (consts) Object.keys(consts).forEach(function(key) {
		setVar(out, key, consts[key]);
	});
	return out;
}


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
	obj[last] = val;
}

