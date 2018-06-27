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
		All.auth.restrict('*'),
		All.cache.tag('api', 'share', 'file'),
		prerender(All.dom)
	);
}

function prerender(dom) {
	return dom(function(mw, settings, req, res) {
		if (req.path != '/.well-known/notfound' && /^(\/[a-zA-Z0-9-]*)+$/.test(req.path) == false) {
			settings.view = req.site.href + '/.well-known/notfound';
			settings.load.disable = true;
			settings.prepare.disable = true;
		} else {
			var scripts = req.site.$resources.map(function(src) {
				return `<script src="${src}"></script>`;
			});
			settings.view = `<!DOCTYPE html>
<html>
<head>
	<title></title>
	${scripts.join('\n')}
</head>
<body>
</body>
</html>`;
		}
	}).load();
}
