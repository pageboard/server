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
			var frag = document.createElement("div");
			var md = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,p,img')).map(function(node) {
				node.removeAttribute('block-id');
				node.removeAttribute('block-type');
				node.removeAttribute('block-content');
				node.removeAttribute('class');
				var tag = node.nodeName.toLowerCase();
				if (tag != "br" && tag != "img" && node.childNodes.length == 0) return;
				frag.appendChild(node.cloneNode(true));
				var heading = tag.match(/h(\d)/);
				if (heading) {
					return Array(parseInt(heading[1]) + 1).join('#') + node.innerText;
				}
				if (tag == "a") return `[${node.innerText}](${node.href})`;
				if (tag == "p") return `\n${node.innerText}\n`;
				if (tag == "img") return `![${node.alt}](${node.src})`;
			});
//			inlineresources.inlineReferences(document, {}).then(function (errors) {
				done(null, {
//					errors: errors,
					title: document.title,
					html: frag.innerHTML,
					text: md.filter(function(line) {
						return !!line;
					}).join('\n')
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

