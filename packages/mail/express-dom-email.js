var Path = require('path');
var readFile = require('util').promisify(require('fs').readFile);

var irBuf;

// TODO can't we just add a load plugin on current All.dom middleware ?
// that would spare a second dom load

exports.mw = function(dom) {
	return function(req, res, next) {
		dom(function(mw, settings) {
			// express-dom 5.9.0 gets the cookie in settings.location
			settings.view = settings.location;
		}).load({
			plugins: [
				mailPlugin
			]
		})(req, res, next);
	};
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
			var fragBody = document.createElement("div");
			var md = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,a,p,img')).map(function(node) {
				node.removeAttribute('block-id');
				node.removeAttribute('block-type');
				node.removeAttribute('block-content');
				node.removeAttribute('class');
				var tag = node.nodeName.toLowerCase();
				if (tag != "br" && tag != "img" && node.childNodes.length == 0) return;
				if (tag == "img") {
					if (node.srcset) {
						delete node.srcset;
					}
					var src = node.src; // absolute url
					if (!src) return;
					var srcParts = src.split('?');
					if (srcParts[0].endsWith('.svg')) {
						if (srcParts.length > 1) src += '&format=png';
						else src += '?format=png';
					}
					node.setAttribute('src', src);
				}
				fragBody.appendChild(node.cloneNode(true));
				var heading = tag.match(/h(\d)/);
				if (heading) {
					return Array(parseInt(heading[1]) + 1).join('#') + node.innerText;
				}
				if (tag == "a") return `[${node.innerText}](${node.href})`;
				if (tag == "p") return `\n${node.innerText}\n`;
				if (tag == "img") return `![${node.alt}](${node.src})`;
			});
			var fragHead = document.createElement("div");
			var jsonld = document.querySelectorAll('script[type="application/ld+json"]');
			Array.from(jsonld).forEach(function(node) {
				node.removeAttribute('id');
				fragHead.appendChild(node.cloneNode(true));
			});
//			inlineresources.inlineReferences(document, {}).then(function (errors) {
				done(null, {
//					errors: errors,
					title: document.title,
					html: `<html><body>${fragHead.innerHTML} ${fragBody.innerHTML}</body></html>`,
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

