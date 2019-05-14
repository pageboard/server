const Path = require('path');
const got = require('got').extend({retry: 0});

module.exports = function(opt) {
	return {
		priority: 0,
		name: 'read',
		view: init
	};
};

function init(All) {
	All.opt.read = {};
	All.opt.read.helpers = [
		'develop',
		'report'
	];
	All.opt.read.plugins = [
		'hide', 'nomedia', 'prerender', 'redirect', 'referrer', 'html',
		'form',
		'httplinkpreload',
		'upcache',
		'httpequivs',
		'bearer',
		'report'
	];
	All.app.get(
		'*',
		All.cache.tag('app-:site'),
		prerender(All.dom)
	);
}

function prerender(dom) {
	return function(req, res, next) {
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
			got(req.site.href + '/.well-known/404').pipe(res);
		} else {
			var scripts = req.site.$resources.map(function(src) {
				return `<script src="${src}" defer></script>`;
			});
			var view = Text`
				<!DOCTYPE html>
				<html>
					<head>
						<title></title>
						${scripts.join('\n')}
					</head>
					<body></body>
				</html>`;
			dom({
				view: view,
				helpers: All.opt.read.helpers,
				plugins: All.opt.read.plugins
			}, req, res, next);
		}
	};
}
