exports.site = function ({ data }) {
	data.extra ??= {};
	for (const key of ['google_site_verification', 'google_tag_manager', 'google_analytics']) {
		if (data[key] != null) data.extra[key] = data[key];
		delete data[key];
	}
};

exports.pdf = function ({ data }) {
	if (data.paper?.preset == "screen") delete data.paper.preset;
};
