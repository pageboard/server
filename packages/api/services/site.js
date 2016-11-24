exports = module.exports = function(config) {
	return {
		name: 'site',
		service: init
	};
};

function init(All) {
	All.app.get('/api/site', function(req, res, next) {
		exports.get(req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.post('/api/site', function(req, res, next) {
		exports.add(req.body).then(function(page) {
			res.send();
		}).catch(next);
	});
	All.app.put('/api/site', function(req, res, next) {
		exports.save(req.body).then(function(page) {
			res.send();
		}).catch(next);
	});
	All.app.delete('/api/site', function(req, res, next) {
		exports.del(req.query).then(function(page) {
			res.send();
		}).catch(next);
	});
}

function QuerySite(data) {
	var q = All.Block.query();
	if (data.id) {
		q.where('id', data.id);
	} else {
		if (!data.url) throw new HttpError.BadRequest("Missing url");
		q.where({
			'block.url': data.url,
			'block.type': 'site'
		});
	}
	return q;
}

exports.get = function(data) {
	return QuerySite(data).select('block.*').first().then(function(site) {
		if (!site) throw new HttpError.NotFound("No site found");
		return site;
	});
};

exports.add = function(data) {
	if (!data.user) throw new HttpError.BadRequest("Missing user");
	data = Object.assign({
		type: 'site',
		mime: '*/*'
	}, data);
	return All.Block.query().select('id').where({
		type: 'user',
		id: data.user
	}).first().then(function(user) {
		data.parents = [{
			'#dbRef': user.id
		}];
		return All.Block.query().insertGraph(data);
	});
};

exports.save = function(data) {
	return QuerySite(data).patch(data);
};

exports.del = function(data) {
	return QuerySite(data).del();
};

