const Path = require('path');
const got = require('got').extend({retry: 0, throwHttpErrors: false});
const { pipeline } = require('stream');

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
		'develop'
	];

	All.opt.read.plugins = [
		'form',
		'httplinkpreload',
		'httpequivs',
		'bearer',
		'hide',
		'nomedia',
		'prerender',
		'redirect',
		'referrer',
		'html'
	];
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
	if (ext && (All.opt.extnames || []).includes(ext)) {
		path = path.slice(0, -ext.length - 1);
		ext = null;
	}
	if (ext && /^(html?|php\d?)$/.test(ext) == false) {
		res.sendStatus(404);
		return;
	}
	next();
}

function prerender(dom) {
	return function(req, res, next) {
		if (req.path != '/.well-known/notfound' && /^(\/[a-zA-Z0-9-]*|(\/[a-zA-Z0-9-]+)+)$/.test(req.path) == false) {
			pipeline(got.stream(req.site.href + '/.well-known/notfound'), res, function(err) {
				if (err) next(err);
			});
		} else {
			var scripts = req.site.$resources.map(function(src) {
				return `<script src="${src}"></script>`;
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
