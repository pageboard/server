module.exports = function upcachePlugin(page, settings, request, response) {
	var locksMap = {};
	var tagsMap = {};
	page.on('response', function(res) {
		var list = res.headers['X-Upcache-Lock'];
		if (list) list.split(',').forEach(function(str) {
			locksMap[str.trim()] = true;
		});
		list = res.headers['X-Upcache-Tag'];
		if (list) list.split(',').forEach(function(str) {
			tagsMap[str.trim()] = true;
		});
	});
	page.when('idle', function() {
		var locks = Object.keys(locksMap);
		if (locks.length) response.obj.locks = locks;
		var tags = Object.keys(tagsMap);
		if (tags.length) response.obj.tags = tags;
	});
};
