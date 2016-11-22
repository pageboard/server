module.exports = function(opt) {
	exports.tag = require('upcache/tag');
	exports.scope = require('upcache/scope')(opt.scope);
	exports.vary = require('upcache/vary');
};

