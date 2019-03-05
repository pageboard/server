module.exports = function upcachePlugin(page) {
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
		var tags = Object.keys(tagsMap);
		if (locks.length || tags.length) return page.run(function(locks, tags) {
			if (locks) {
				var metaLocks = document.createElement('meta');
				metaLocks.setAttribute('http-equiv', 'X-Upcache-Lock');
				metaLocks.setAttribute('content', locks);
				document.head.appendChild(metaLocks);
			}
			if (tags) {
				var metaTags = document.createElement('meta');
				metaTags.setAttribute('http-equiv', 'X-Upcache-Tag');
				metaTags.setAttribute('content', tags);
				document.head.appendChild(metaTags);
			}
		}, locks.join(','), tags.join(','));
	});
};
