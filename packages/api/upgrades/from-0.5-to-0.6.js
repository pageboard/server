exports.any = function(block) {
	var locks = block.lock && block.lock.read;
	if (locks) locks.forEach(function(lock, i) {
		locks[i] = lock.replace(/^user-/, "id-");
	});
};

exports.notfound = function(block) {
	block.type = "page";
	block.data = Object.assign(block.data || {}, {
		url: '/.well-known/404',
		noindex: true,
		nositemap: true
	});
};

