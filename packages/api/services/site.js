var equal = require('esequal');

exports = module.exports = function(opt) {
	return {
		name: 'site',
		service: init
	};
};

function init(All) {
	All.app.get('/.api/site', All.auth.restrict('webmaster'), All.query, function(req, res, next) {
		exports.get(req.query).then(function(site) {
			res.send(site);
		}).catch(next);
	});
	All.app.post('/.api/site', All.auth.restrict('webmaster'), All.body, function(req, res, next) {
		exports.add(req.body).then(function(site) {
			res.send(site);
		}).catch(next);
	});
	All.app.put('/.api/site', All.auth.restrict('webmaster'), All.body, function(req, res, next) {
		exports.save(req.body).then(function(site) {
			res.send(site);
		}).catch(next);
	});
	All.app.delete('/.api/site', All.auth.restrict('webmaster'), All.query, function(req, res, next) {
		exports.del(req.query).then(function(site) {
			res.send(site);
		}).catch(next);
	});
}

function QuerySite(data) {
	var q = All.api.Block.query().alias('site').first().throwIfNotFound();
	if (data.id) {
		q.where('site.id', data.id);
	} else {
		if (!data.domain) throw new HttpError.BadRequest("Missing domain");
		q.whereJsonText('site.data:domain', data.domain).where('site.type', 'site');
	}
	return q;
}

exports.get = function(data) {
	return QuerySite(data).select(All.api.Block.tableColumns);
};

exports.add = function(data) {
	if (!data.user) throw new HttpError.BadRequest("Missing user");
	return QuerySite({domain: data.data.domain}).then(function(site) {
		console.info("Not adding already existing site", data.data.domain);
	}).catch(function(err) {
		data = Object.assign({
		type: 'site'
		}, data);
		return All.user.get({
			email: data.user
		}).select('_id').then(function(user) {
			data.parents = [{
				'#dbRef': user._id
			}];
			data.children = [{
				'#dbRef': user._id // a user is also child of its own site
			}, {
				type: 'notfound',
				standalone: true
			}];
			delete data.user;
			return All.api.Block.query().insertGraph(data);
		});
	});
};

exports.save = function(data) {
	return exports.get(data).then(function(site) {
		if (data.domain) delete data.domain;
		var sameDeps = equal(
			data.data && data.data.dependencies || null,
			site.data && site.data.dependencies || null
		);
		// ensure we don't just empty site.data by mistake
		data.data = Object.assign({}, site.data, data.data);
		return site.$query().where('id', site.id).patch(data).then(function(result) {
			if (sameDeps == false) return All.install(data.data).then(() => result);
			else return result;
		});
	});
};

exports.del = function(data) {
	return QuerySite(data).del();
};

exports.own = function(data) {
	if (!data.user) throw new HttpError.BadRequest("Missing user");
	if (!data.domain) throw new HttpError.BadRequest("Missing domain");
	return QuerySite(data).select('site._id').then(function(site) {
		return All.user.get({email: data.user}).clearSelect().select('user._id')
		.eager('[children(ownedSites), parents(owningSites)]', {
			ownedSites: function(builder) {
				builder.select('_id').whereJsonText('data:domain', data.domain)
				.where('type', 'site');
			},
			owningSites: function(builder) {
				builder.select('_id').whereJsonText('data:domain', data.domain)
				.where('type', 'site');
			}
		}).then(function(user) {
			var proms = [];
			if (!user.children.length) {
				proms.push(user.$relatedQuery('children').relate(site).then(function() {
					return "user owns site";
				}));
			}
			if (!user.parents.length) {
				proms.push(user.$relatedQuery('parents').relate(site).then(function() {
					return "site owns user";
				}));
			}
			if (!proms.length) return "nothing to do";
			else return Promise.all(proms);
		});
	});
};
