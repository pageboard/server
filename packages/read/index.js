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
		All.dom(function(mw, settings, req, res) {
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
		}).load()
	);
}
