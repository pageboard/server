var fs = require('fs');
var Path = require('path');

module.exports = function(page, settings, request, response) {
	var root = request.app.get('views');
	page.when('ready', function(cb) {
		page.run(function(done) {
			done(null, Array.from(document.querySelectorAll('link[rel="insert"]')).map(function(node) {
				return node.getAttribute('href');
			}));
		}, function(err, paths) {
			if (err) return cb(err);
			Promise.all(paths.map(function(path) {
				return new Promise(function(resolve, reject) {
					fs.readFile(Path.join(root, path), function(err, buf) {
						if (err) {
							console.error(err);
							resolve();
						} else {
							resolve({path: path, str: buf.toString()});
						}
					});
				});
			})).then(function(args) {
				if (args.length == 0) return cb();
				page.run(function(args, done) {
					function replaceImport(node, doc) {
						Array.from(doc.querySelectorAll('link[rel="import"]'))
						.forEach(function(link) {
							var href = link.getAttribute('href');
							if (document.querySelector(`link[rel="import"][href="${href}"]`)) return;
							var txt = document.createTextNode('\n\t');
							var last = Array.from(document.querySelectorAll('link[rel="import"]')).pop();
							(last || document.head.lastElementChild).after(txt);
							var imported = document.importNode(link, true);
							txt.after(imported);
						});
						var cur = doc.body.firstElementChild;
						var last = doc.body.lastElementChild;
						var after = node;
						do {
							after.after(document.importNode(cur, true));
							after = after.nextSibling;
							if (cur == last) break;
							cur = cur.nextSibling;
						} while (cur);
						node.remove();
					}
					args.forEach(function(arg) {
						var doc = document.implementation.createHTMLDocument('');
						doc.open();
						doc.write(arg.str);
						doc.close();
						Array.from(document.querySelectorAll(`link[rel="insert"][href="${arg.path}"]`))
						.forEach(function(node) {
							replaceImport(node, doc);
						});
					});
					done();
				}, args, cb);
			}).catch(cb);
		});
	});
};

