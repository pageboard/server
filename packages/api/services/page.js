exports = module.exports = function(config) {
	return {
		name: 'page',
		service: init
	};
};

function init(All) {
	All.app.post('/api/page', function(req, res, next) {
		exports.create(req.body).then(function(page) {
			res.sendStatus(200);
		}).catch(next);
	});
}

exports.get = function(data) {
	return All.Block.query().where({
		url: data.url,
		type: 'page',
		mime: 'text/html'
	})
	.eager('children.^')
	.joinRelation('parents').where({
		type: 'site',
		'parents.url': data.site
	}).first();
};

exports.create = function(data) {
	data = Object.assign({
		type: 'page',
		mime: 'text/html'
	}, data);
	return All.Block.query().where({
		type: 'site',
		url: data.site
	}).first().then(function(site) {
		return All.Block.query().insert(data).$relatedQuery('parents').relate(site.id);
	});
};


exports.remove = function(data) {
	if (!data.url || !data.site) {
		return Promise.reject(new HttpError.BadRequest("Missing url or site"));
	}

	return All.Block.query().del().where(url, data.url)
		.joinRelation('parents').where({
			type: 'site',
			'parents.url': data.site
		});
};

