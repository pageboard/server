var version = find('nsocket/node_modules/socket.io-client');
if (!version) version = find('socket.io-client');
if (!version) console.warn('no socket.io-client module found');

function find(path) {
	var obj;
	try { obj = require(path + '/package'); } catch(ex) {}
	if (obj) return obj.version;
}

module.exports = function(opts) {
	opts.version = version;
	return function(page, settings, request, response) {
		page.when('idle', function() {
			return page.run(function(opts, done) {
				var root = document.querySelector(opts.selector);
				if (!root) return done("Missing root: " + opts.selector);
				delete opts.selector;
				if (opts.servers == "*") opts.servers = '//' + document.location.host;
				root.setAttribute('data-nsocket', JSON.stringify(opts));
				done();
			}, opts);
		});
	};
};

