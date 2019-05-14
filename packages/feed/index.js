const Feed = require("./lib/feed");

exports = module.exports = function(opt) {
	return {
		priority: -9, // because default prerendering happens at 0
		name: 'feed',
		view: init
	};
};

function init(All) {
	All.app.get(
		/^(\/[a-zA-Z0-9-]*|(\/[a-zA-Z0-9-]+)+)\.rss$/,
		All.auth.restrict('*'),	All.cache.tag('data-:site').for('1 day'),
		function(req, res, next) {
			All.run('feed.get', req, {
				url: req.params[0],
				query: req.query
			}).then(function(xml) {
				res.type("application/xml");
				res.send(xml);
			}).catch(next);
		}
	);
}

exports.get = function(req, data) {
	return All.run('page.list', req, {
		parent: data.url,
		home: true
	}).then(function(obj) {
		var home = obj.item;
		if (!home || home.data.url != data.url) throw new HttpError.NotFound("No feed");
		All.auth.filterResponse(req, obj);
		return Feed(req.site, obj.item, obj.items).rss2(); // atom1 json1
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
		hostname: {
			type: 'string',
			format: 'hostname'
		}
	}
};
// exports.get.external = true;





