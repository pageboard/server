const Feed = require("./lib/feed");

exports = module.exports = function(opt) {
	return {
		priority: -9, // because default prerendering happens at 0
		name: 'feed',
		view: function(All) {
			All.app.get(
				/^(\/[a-zA-Z0-9-]*|(\/[a-zA-Z0-9-]+)+)\.rss$/,
				All.auth.restrict('*'),	All.cache.tag('data-:site'),
				function(req, res, next) {
					All.run('feed.get', req.site, {
						url: req.params[0],
						query: req.query
					}).then(function(xml) {
						res.type("application/xml");
						res.send(xml);
					}).catch(next);
				}
			);
		}
	};
};

exports.get = function(site, data) {
	return All.run('page.list', site, {
		parent: data.url,
		home: true,
		user: data.user
	}).then(function(obj) {
		var home = obj.item;
		if (!home || home.data.url != data.url) throw new HttpError.NotFound("No feed");
		All.filter(site, (data.user || {}).scopes, obj);
		return Feed(site, obj.item, obj.items).rss2(); // atom1 json1
	});
};

exports.get.schema = {
	title: 'Export as RSS',
	required: ['url'],
	$action: "read",
	properties: {
		url: {
			title: 'Feed url',
			type: "string",
			pattern: "^(/[a-zA-Z0-9-]*)+$",
			$helper: 'pageUrl'
		},
		user: {
			type: 'object',
			nullable: true
		},
		hostname: {
			type: 'string',
			format: 'hostname'
		}
	}
};
// exports.get.external = true;





