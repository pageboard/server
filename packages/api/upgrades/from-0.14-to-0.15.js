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
