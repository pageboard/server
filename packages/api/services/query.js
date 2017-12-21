exports = module.exports = function(opt) {
	return {
		name: 'query',
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
		id: data.parent,
		domain: data.domain
	}).then(function(parent) {
		var fd = parent.data.query;
		var params = Object.assign({}, fd.consts || {});
		Object.keys(fd.vars || {}).forEach(function(key) {
			if (data[key] !== undefined) params[key] = data[key];
		});
		params.domain = data.domain;
		return All.run(fd.call, params);
	});
};

