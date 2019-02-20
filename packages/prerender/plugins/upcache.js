module.exports = function upcachePlugin(page) {
	var scopesMap = {};
	var tagsMap = {};
	page.on('response', function(res) {
		var list = res.headers['X-Upcache-Scope'];
		if (list) list.split(',').forEach(function(str) {
			scopesMap[str.trim()] = true;
		});
		list = res.headers['X-Upcache-Tag'];
		if (list) list.split(',').forEach(function(str) {
			tagsMap[str.trim()] = true;
		});
	});
	page.when('idle', function() {
		var scopes = Object.keys(scopesMap);
		var tags = Object.keys(tagsMap);
		if (scopes.length || tags.length) return page.run(function(scopes, tags) {
			if (scopes) {
				var metaScopes = document.createElement('meta');
				metaScopes.setAttribute('http-equiv', 'X-Upcache-Scope');
				metaScopes.setAttribute('content', scopes);
				document.head.appendChild(metaScopes);
			}
			if (tags) {
				var metaTags = document.createElement('meta');
				metaTags.setAttribute('http-equiv', 'X-Upcache-Tag');
				metaTags.setAttribute('content', tags);
				document.head.appendChild(metaTags);
			}
		}, scopes.join(','), tags.join(','));
	});
};
