exports.helper = function(mw, settings) {
	var opts = settings.extensions || {};
	var list = opts.list || [];
	if (!settings.filters) settings.filters = [];
	settings.filters.push([function(list, allow) {
		if (this.uri.startsWith("data:")) return;
		var path = (new URL(this.uri, document.location)).pathname;
		if (!path) return;
		var ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
		if (list.includes(ext)) {
			if (!allow) this.cancel = true;
		} else {
			if (allow) this.cancel = true;
		}
	}, list, opts.allow]);
};

