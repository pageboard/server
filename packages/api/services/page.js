exports = module.exports = function(config) {
	return {
		name: 'page',
		service: init
	};
};

function init(All) {
	All.app.get('/api/page', function(req, res, next) {
		exports.get(All.assignSite(req, req.query)).then(function(page) {
			res.send(page);
		}).catch(next);
	});
	All.app.post('/api/page', function(req, res, next) {
		exports.create(All.assignSite(req, req.body)).then(function(page) {
			res.send();
		}).catch(next);
	});
	All.app.delete('/api/page', function(req, res, next) {
		exports.remove(All.assignSite(req, req.query)).then(function(page) {
			res.send();
		}).catch(next);
	});
}

exports.get = function(data) {
	if (!data.site) throw new HttpError.BadRequest("Missing site");
	if (!data.url) throw new HttpError.BadRequest("Missing url");
	return All.Block.query().select('block.*').where({
		'block.url': data.url,
		'block.type': 'page',
		'block.mime': 'text/html'
	})
	.eager('children.^')
	.joinRelation('parents').where({
		'parents.type': 'site',
		'parents.url': data.site
	}).first().then(function(page) {
		if (!page) throw new HttpError.NotFound("No page found");
		return page;
	});
};

exports.create = function(data) {
	if (!data.site) throw new HttpError.BadRequest("Missing site");
	data = Object.assign({
		type: 'page',
		mime: 'text/html'
	}, data);
	return All.Block.query().where({
		type: 'site',
		url: data.site
	}).first().then(function(site) {
		data.parents = [{
			'#dbRef': site.id
		}];
		return All.Block.query().insertGraph(data);
	});
};


exports.remove = function(data) {
	if (!data.site) throw new HttpError.BadRequest("Missing site");
	if (!data.url) throw new HttpError.BadRequest("Missing url");

	return All.Block.query().del().where(url, data.url)
		.joinRelation('parents').where({
			'parents.type': 'site',
			'parents.url': data.site
		});
};

