exports.site = function ({ data }) {
	data.extra ??= {};
	for (const key of ['google_site_verification', 'google_tag_manager', 'google_analytics', 'linkedin']) {
		if (data[key] != null) data.extra[key] = data[key];
		delete data[key];
	}
	data.languages ??= [];
	if (data.lang && data.languages.length == 0) {
		data.languages.push(data.lang);
		delete data.lang;
	}
};

exports.pdf = function ({ data }) {
	if (!data.paper) return;
	if (data.paper.preset == "screen") delete data.paper.preset;
	if (data.paper.width) data.paper.width = parseFloat(data.paper.width);
	if (data.paper.height) data.paper.height = parseFloat(data.paper.height);
	if (data.paper.margin) data.paper.margin = parseFloat(data.paper.margin);
	if (data.paper.spine) data.paper.margin = parseFloat(data.paper.spine);
};

exports.any = function ({ type, data, content }) {
	if (['page', 'pdf', 'mail'].includes(type)) {
		if (data.title != null) {
			content.title = data.title;
			delete data.title;
		}
		if (data.description != null) {
			content.description = data.description;
			delete data.description;
		}
	}
	if (type.startsWith('input_')) {
		if (data.placeholder != null) {
			if (!content.label) {
				content.label = data.placeholder;
			}
			delete data.placeholder;
		}
	}
};
