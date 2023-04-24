exports.any = function (block) {
	const { lock } = block;
	if (lock) {
		if (lock.read) block.lock = lock.read;
		else delete block.lock;
	}
};

exports.menu = function ({ data }) {
	if (data?.direction === "") {
		data.direction = null;
	}
};

exports.carousel = function ({ data }) {
	if (data?.height && !data.heightUnits) data.heightUnits = 'vh';
};

exports.layout = function ({ data }) {
	if (data?.height && !data.heightUnits) data.heightUnits = 'vh';
};

exports.image = function (block, { type } = {}) {
	const { data = {} } = block;
	if (!block.data) block.data = data;
	if (type == "card") {
		if (!data.display) data.display = {};
		if (!data.display.fit || data.display.fit == "none") {
			data.display.fit = 'contain';
		}
	}
};

exports.input_date_slot = exports.input_date_time = function ({ data }) {
	if (data.step === 60) data.step = 60 * 60;
	else if (data.step === undefined) data.step = null;
};

exports.inventory_item = function ({ data }) {
	if (Array.isArray(data.links) && data.links.length > 0 && typeof data.links[0] == "string") data.links = null;
	if (Array.isArray(data.medias)) for (const media of data.medias) {
		if (media.source === "") media.source = null;
	}
};
