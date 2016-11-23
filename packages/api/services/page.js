exports = module.exports = function(config) {
	return {
		name: 'page',
		service: init
	};
};

function init(All) {
	if (All.opt._.includes("create") && All.opt.page) {
		return exports.create(All.opt.page).then(function(page) {
			console.log("create page", page);
		});
	}
	All.app.post('/api/page', function(req, res, next) {
		exports.create(req.body).then(function(page) {
			res.sendStatus(200);
		}).catch(next);
	});
}

exports.create = function(data) {
	data = Object.assign({
		type: 'page',
		mime: 'text/html'
	}, data);
	return All.Site.query().where('domain', data.domain).first().then(function(site) {
		data.site_id = site.id;
		return All.Block.query().insert(data);
	});
};

exports.remove = function(data) {
	if (!data.url || !data.domain) {
		return Promise.reject(new HttpError.BadRequest("Missing url"));
	}

	return All.Block.query().del().where(url, data.url)
		.joinRelation('site').where('site.domain', data.domain);
};

