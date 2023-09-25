exports.site = function ({ data }) {
	data.extra ??= {};
	for (const key of ['google_site_verification', 'google_tag_manager', 'google_analytics', 'linkedin']) {
		if (data[key] != null) data.extra[key] = data[key];
		delete data[key];
	}
};

exports.pdf = function ({ data }) {
	if (data.paper?.preset == "screen") delete data.paper.preset;
	if (data.paper.width) data.paper.width = parseFloat(data.paper.width);
	if (data.paper.height) data.paper.height = parseFloat(data.paper.height);
	if (data.paper.margin) data.paper.margin = parseFloat(data.paper.margin);
	if (data.paper.spine) data.paper.margin = parseFloat(data.paper.spine);
};
