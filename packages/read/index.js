const Path = require('path');

module.exports = function(opt) {
	return {
		priority: 0,
		view: init
	};
};

function init(All) {
	// TODO use opt.prerender to configure dom plugins
	// TODO expose route for preload and route for load,
	// the route for load will use the preload route as source (view helper can pipe http requests)
	All.app.get(
		'*',
		All.cache.tag('site-:site'),
		prerender(All.dom)
	);
}

function prerender(dom) {
	return dom(function(mw, settings, req, res) {
		var el = req.site.$schema('page');
		var pattern = el && el.properties.data && el.properties.data.properties.url.pattern;
		if (!pattern) throw new Error("Missing page element missing schema for data.url.pattern");
		var urlRegex = new RegExp(pattern);
		var path = req.path;
		var ext = Path.extname(path).substring(1);
		if (ext && (All.opt.extnames || []).includes(ext)) {
			path = path.slice(0, -ext.length - 1);
		}
		if (urlRegex.test(path) == false) {
			settings.view = req.site.href + '/.well-known/404';
			settings.load.disable = true;
			settings.prepare.disable = true;
		} else {
			if (req.query.develop !== undefined) {
				All.cache.map(res, '/.well-known/200');
			}
			var scripts = req.site.$resources.map(function(src) {
				return `<script src="${src}" defer></script>`;
			});
			settings.view = Text`
				<!DOCTYPE html>
				<html>
					<head>
						<title></title>
						${scripts.join('\n')}
					</head>
				<body></body>
				</html>
			`;
		}
	}).load();
}
