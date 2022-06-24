exports.menu = function ({ data }) {
	if (data?.direction === "") data.direction = null;
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
