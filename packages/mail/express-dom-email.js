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
			function convertNode(parent) {
				var frag = document.createElement("div");
				var md = [];
				processNodes(parent, frag, md);
				return {
					html: frag.innerHTML,
					md: md.filter(function(line) {
						return !!line;
					}).join('\n')
				};
			}
			function processNodes(node, frag, md) {
				if (node.nodeType == Node.TEXT_NODE) {
					frag.appendChild(node);
					var txt = node.nodeValue.trim();
					if (txt != "") md.push(node.nodeValue);
					return;
				}
				node.removeAttribute('block-type');
				node.removeAttribute('block-id');
				node.removeAttribute('block-content');

				var tag = node.tagName.toLowerCase();
				if (tag == "img") {
					if (node.srcset) {
						delete node.srcset;
					}
					var src = node.src; // absolute url
					if (!src) {
						node.remove();
						return;
					}
					var srcParts = src.split('?');
					if (srcParts[0].endsWith('.svg')) {
						if (srcParts.length > 1) src += '&format=png';
						else src += '?format=png';
					}
					node.setAttribute('src', src);
					frag.appendChild(node);
					md.push(`![${node.alt}](${node.src})`);
				} else if (tag == "a") {
					node.setAttribute('href', node.href);
					frag.appendChild(node);
					md.push(`[${node.innerText}](${node.href})`);
				} else if (tag == "br") {
					frag.appendChild(node);
					md.push("");
				} else if (tag == "hr") {
					frag.appendChild(node);
					md.push("--");
				} else if (node.childNodes.length == 0) {
					return;
				} else if (tag.match(/h(\d)/)) {
					frag.appendChild(node);
					md.push(Array(parseInt(tag[1]) + 1).join('#') + node.innerText);
				} else {
					if (tag == "element-query") {
						node.firstElementChild.remove();
					}
					var copy = node.cloneNode(false);
					Array.from(node.childNodes).forEach(function(child) {
						processNodes(child, copy, md);
					});
					if (copy.textContent.trim() != "") frag.appendChild(copy);
				}
			}
			var obj = convertNode(document.body);
//			inlineresources.inlineReferences(document, {}).then(function (errors) {
				done(null, {
//					errors: errors,
					title: document.title,
					html: `<html>${obj.html}</html>`,
					text: obj.md
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

