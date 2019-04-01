var Path = require('path');

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
		All.auth.vary('*'),
		All.cache.tag('site-:site', 'data-:site'),
		optimize,
		prerender(All.dom)
	);
}

function optimize(req, res, next) {
	var path = req.path;
	if (path == '/.well-known/notfound') {
		next();
		return;
	}
	if (path.startsWith('/.')) {
		res.sendStatus(404);
		return;
	}
	var ext = Path.extname(path).substring(1);
	if (ext && /^(html?|php\d?)$/.test(ext) == false) {
		res.sendStatus(404);
		return;
	}
	next();
}

function prerender(dom) {
	return dom(function(mw, settings, req, res) {
		if (req.path != '/.well-known/notfound' && /^(\/[a-zA-Z0-9-]*|(\/[a-zA-Z0-9-]+)+)$/.test(req.path) == false) {
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
