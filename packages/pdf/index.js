module.exports = function(opt) {
	return {
		priority: 1, // after prerender plugin
		view: init
	};
};

function init(All) {
	All.opt.prerender.plugins.push(require.resolve('./lib/pdf'));
}

