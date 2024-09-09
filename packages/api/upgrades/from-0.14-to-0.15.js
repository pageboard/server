exports.print_job = function ({ data }) {
	if (!data.device || !data.printer) {
		if (data.options?.cover?.url) {
			data.device = 'printer';
			data.printer = 'remote';
		} else if (data.printer == "storage") {
			data.device = 'printer';
			data.printer = 'offline';
		}
	}
};

exports.mail_job = function ({ data }) {
	// TODO some mail_job should become print_job
};

exports.pdf = function ({ data }) {
	if (!data.paper) return;
	if (data.paper.preset == "screen") delete data.paper.preset;
	if (data.paper.width) data.paper.width = parseFloat(data.paper.width);
	if (data.paper.height) data.paper.height = parseFloat(data.paper.height);
	if (data.paper.margin) data.paper.margin = parseFloat(data.paper.margin);
	if (data.paper.spine) data.paper.spine = parseFloat(data.paper.spine);
};
