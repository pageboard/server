var Path = require('path');
var readFile = require('util').promisify(require('fs').readFile);

var irBuf;

exports.mw = function(mw, settings, request, response) {
	var opts = request.query.email;
	if (opts == null) return Promise.reject('route');
	delete request.query.email;
	mw.load({plugins: [mailPlugin]});
	// sets the view to be fetched from current request url, effectively doing a subrequest
	settings.view = settings.location;
};

exports.init = function() {
	return readFile(Path.join(__dirname, 'lib/inlineresources.js')).then(function(buf) {
		irBuf = buf;
	});
};

function mailPlugin(page, settings, request, response) {
//	settings.scripts.push(irBuf);
	page.when('idle', function() {
		return page.run(function(done) {
//			inlineresources.inlineReferences(document, {}).then(function (errors) {
				done(null, {
//					errors: errors,
					title: document.title,
					html: `<html>${document.body.outerHTML}</html>`,
					text: document.body.innerText
				});
//			});
		}).then(function(obj) {
			settings.output = false;
			response.json(obj);
		}).catch(function(err) {
			settings.output = err;
			response.status(500);
		});
	});
}

