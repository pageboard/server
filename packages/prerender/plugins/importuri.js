var fs = require('fs');
var Path = require('path');
var URL = require('url');

module.exports = function(page, settings, request, response) {
	if (process.env.NODE_ENV != "production") return;
	var root = request.app.get('views');
	page.when('ready', function(wcb) {
		page.run(function(cb) {
			return cb(null, Array.from(document.querySelectorAll('link[rel="import"]')).map(function(link) {
				return link.getAttribute("href");
			}));
		}, function(err, list) {
			Promise.all(list.map(function(href) {
				var item = {
					href: href
				};
				return new Promise(function(resolve) {
					fs.readFile(Path.join(root, URL.parse(href).pathname), function(err, buf) {
						if (err) console.error(err);
						if (buf) item.data = buf.toString();
						resolve(item);
					});
				});
			})).then(function(list) {
				page.run(function(list, cb) {
					list.forEach(function(item) {
						var link = document.querySelector(`link[href="${item.href}"]`);
						if (!link) return console.error("Missing link", item.href);
						if (!item.data) return;
						var data = item.data.replace('<head>', `<head><base href="${document.baseURI}">`);
						link.setAttribute('href', 'data:text/html;charset=utf-8,' + encodeURIComponent(data));
					});
					cb();
				}, list, wcb);
			});
		});
	});
};

