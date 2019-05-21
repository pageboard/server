const Path = require('path');

module.exports = function(opt) {
	return {
		priority: 1, // after read plugin
		name: 'pdf',
		view: init
	};
};

function init(All) {
	var path = Path.join(__dirname, './lib/pdf');
	All.opt.prerender.helpers.unshift(path);
	All.opt.prerender.plugins.push(path);
	All.opt.read.helpers.push('pdf');
	All.opt.extnames.push('pdf');
}

