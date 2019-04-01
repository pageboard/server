var csp = require("content-security-policy-builder");

module.exports = function cspPlugin(page, settings, request, response) {
	page.when('idle', function() {
		page.run(function() {
			var scriptHosts = {};
			Array.from(
				document.querySelectorAll('script[src]')
			).forEach(function(node) {
				var obj = Page.parse(node.src);
				if (obj.hostname) scriptHosts['https://' + obj.hostname] = true;
			});
			var styleHosts = {};
			Array.from(
				document.querySelectorAll('link[href]')
			).forEach(function(node) {
				var obj = Page.parse(node.href);
				if (obj.hostname) styleHosts['https://' + obj.hostname] = true;
			});
			return {script: Object.keys(scriptHosts), style: Object.keys(styleHosts)};
		}).then(function(hosts) {
			var self = "'self'";
			response.setHeader('Content-Security-Policy', csp({
				directives: {
					defaultSrc: [self, 'https:'],
					scriptSrc: [self, "'unsafe-eval'", 'https:'].concat(hosts.script),
					styleSrc: [self, "'unsafe-inline'", 'https:'].concat(hosts.style),
					fontSrc: [self, 'https:', 'data:']
				}
			}));
		});
	});
};

