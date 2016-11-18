var polyfill = require('polyfill-ua');

module.exports = function(map) {
	var polyfills = (function(map) {
		for (var feature in map) {
			// https://github.com/polyfills/polyfill-ua/issues/14
			map[feature] = {
				script: map[feature],
				checkAgent: polyfill.caniuse(feature)
			};
		}
		return map;
	})(map);
	return function polyfillPlugin(page, settings, request) {
		page.when('idle', function(cb) {
			var agent = polyfill.parse(request.get('User-Agent'));
			var scripts = {};
			Object.keys(polyfills).map(function(feature) {
				var po = polyfills[feature];
				if (po.checkAgent(agent)) {
					scripts[po.script] = true;
				}
			});
			scripts = Object.keys(scripts);
			if (scripts.length == 0) return cb();
			this.run(function(scripts, done) {
				var src;
				var caret = document.head.querySelector('script');
				if (!caret) return done();
				while (src = scripts.pop()) {
					var script = document.createElement('script');
					script.setAttribute('type', 'text/plain');
					script.setAttribute('src', src);
					var text = document.createTextNode("\n\t");
					caret.before(text);
					text.before(script);
					script.setAttribute('type', 'text/javascript');
				}
				done();
			}, scripts, cb);
		});
	};
};

