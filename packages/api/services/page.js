exports = module.exports = function(opt) {
	return {
		name: 'page',
		service: init
	};
};

function init(All) {
	All.app.get('/api/page', function(req, res, next) {
		exports.get(reqData(req)).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.post('/api/page', function(req, res, next) {
		exports.add(reqData(req)).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.put('/api/page', function(req, res, next) {
		exports.save(reqData(req)).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.delete('/api/page', function(req, res, next) {
		exports.del(reqData(req)).then(function(page) {
			res.send(page);
		}).catch(next);
	});
}

function QueryPage(data) {
	var ref = All.objection.ref;
	var q = All.Block.query();
	var site = data.site;
	if (site) delete data.site;
	if (data.id) {
		q.where('id', data.id);
	} else {
		if (!site) throw new HttpError.BadRequest("Missing site");
		if (!data.url) throw new HttpError.BadRequest("Missing url");
		q.where('block.type', 'page')
		.where(ref("block.data:url").castText(), data.url)
		.joinRelation('parents')
		.where('parents.type', 'site')
		.where(ref('parents.data:url').castText(), site);
	}
	return q;
}

function reqData(req) {
	var obj = req.body || req.query;
	obj.site = All.opt.site || req.hostname;
	return obj;
}

function assignSite(req, obj) {
	return Object.assign({}, obj, {
		site: req.hostname
	});
}

exports.get = function(data) {
	return QueryPage(data).select('block.*')
	.eager('children.^').first().then(function(page) {
		if (!page) throw new HttpError.NotFound("No page found");
		return page;
	});
};

exports.add = function(data) {
	var ref = All.objection.ref;
	if (!data.site) throw new HttpError.BadRequest("Missing site");
	data = Object.assign({
		type: 'page'
	}, data);
	return All.Block.query()
		.where('type', 'site')
		.where(ref('data:url').castText(), data.site)
	.first().then(function(site) {
		data.parents = [{
			'#dbRef': site.id
		}];
		delete data.site;
		return All.Block.query().insertGraph(data);
	});
};

exports.save = function(data) {
	return QueryPage(data).patch(data);
};

exports.del = function(data) {
	return QueryPage(data).del();
};

