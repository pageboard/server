var csp = require("content-security-policy-builder");

module.exports = function cspPlugin(page, settings, request, response) {
	page.when('idle', function() {
		page.run(function() {
			var hosts = {};
			Array.from(
				document.querySelectorAll('script[src]')
			).forEach(function(node) {
				var obj = Page.parse(node.src);
				if (obj.hostname) hosts[obj.hostname] = true;
			});
			return Object.keys(hosts);
		}).then(function(hosts) {
			response.setHeader('Content-Security-Policy', csp({
				directives: {
					defaultSrc: ["'self'"],
					scriptSrc: hosts
				}
			}));
		});
	});
};

