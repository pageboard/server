var polyfill = require('polyfill-ua');

module.exports = function iePlugin(page, settings, request) {
	page.when('idle', function(cb) {
		var agent = polyfill.parse(request.get('User-Agent'));
		var ieClass = (/\b(ie|internet explorer)\b/i.test(agent.family)
			&& (agent.major == 8 || agent.major == 9))
			? "ie" + agent.major
			: null;
		if (!ieClass) return cb();
		this.run(function(ieClass, done) {
			document.documentElement.classList.add(ieClass);
			done();
		}, ieClass, cb);
	});
};

