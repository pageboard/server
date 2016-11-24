exports = module.exports = function(config) {
	return {
		name: 'user',
		service: init
	};
};

function init(All) {
	All.app.get('/api/user', function(req, res, next) {
		exports.get(req.query).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.post('/api/user', function(req, res, next) {
		exports.add(req.body).then(function(page) {
			res.send();
		}).catch(next);
	});
	All.app.put('/api/user', function(req, res, next) {
		exports.save(req.body).then(function(page) {
			res.send();
		}).catch(next);
	});
	All.app.delete('/api/user', function(req, res, next) {
		exports.del(req.query).then(function(page) {
			res.send();
		}).catch(next);
	});
}

function QueryUser(data) {
	var q = All.Block.query();
	if (data.id) {
		q.where('id', data.id);
	} else {
		if (!data.url) throw new HttpError.BadRequest("Missing url");
		q.where({
			'block.url': data.url,
			'block.type': 'user'
		});
	}
	return q;
}

exports.get = function(data) {
	return QueryUser(data).select('block.*').first().then(function(user) {
		if (!user) throw new HttpError.NotFound("No user found");
		return user;
	});
};

exports.add = function(data) {
	data = Object.assign({
		type: 'user',
		mime: 'application/json'
	}, data);
	return All.Block.query().insertGraph(data);
};

exports.save = function(data) {
	return QueryUser(data).patch(data);
};

exports.del = function(data) {
	return QueryUser(data).del();
};

