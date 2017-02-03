module.exports = function(opt) {
	opt.statics.mounts.push(__dirname + '/public');
	return {
		view: init
	};
};

function init(All) {
	All.app.get('*', All.dom('read').load());
}
