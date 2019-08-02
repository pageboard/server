const Path = require('path');

exports = module.exports = function(opt) {
	return {
		priority: 1, // because default prerendering happens at 0
		name: 'feed',
		view: function(All) {
			All.opt.extnames.push('rss');
			var path = Path.join(__dirname, './lib/rss');
			All.opt.prerender.helpers.unshift(path);
			All.opt.prerender.plugins.push(path);
			All.opt.read.helpers.push('rss');
		}
	};
};

