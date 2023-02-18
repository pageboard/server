exports.any = function (block) {
	const { expr } = block;
	if (!expr) return;
	block.expr = JSON.parse(doReplacements(JSON.stringify(expr)));
};

function doReplacements(str) {
	const replacements = [
		["|!?|bmagnet:", '|not:prune:'],
		["|!|bmagnet]", "|not:prune:]"],
		["|!|bmagnet:", "|not:prune:"],
		["|?|bmagnet:", '|prune:'],
		["|slug", '|as:slug'],
		["|opt", '?'],
		[/\|\?:([^|:]*):([^|:]*)/g, '|alt:$1:$2'],
		["|url", "|as:url"],
		["|magnet:", "|fail:"],
		["|magnet]", "|fail:]"],
		["|bmagnet]", "|prune:]"],
		["|bmagnet:", "|prune:"],
		["|eq:a-la-une:", "|eq:a-la-une|alt:"],
		["[$item.data.", "["],
		["[$item.items", "[$items"],
		[
			"$items|repeat:.layout:item:0:0:1|prune:*",
			"$items|at:.layout|.first|repeat:item|prune:*"
		],
		[
			"$items|repeat:.layout:item:3:0|prune:*",
			"$items|at:.layout|nth:3:0|repeat:item|prune:*"
		],
		[
			"$items|repeat:.layout:item:3:1|prune:*",
			"$items|at:.layout|nth:3:1|repeat:item|prune:*"
		],
		[
			"$items|repeat:.layout:item:3:2|prune:*",
			"$items|at:.layout|nth:3:2|repeat:item|prune:*"
		],
		[
			"$items|repeat:.layout:item:3:3|prune:*",
			"$items|at:.layout|nth:3:3|repeat:item|prune:*"
		],
		[
			"[$items.data.thumbnail|repeat:.wide.column:item|magnet:*]",
			"[$items|at:.wide.column|repeat:item|.data.thumbnail|fail:*]"
		],
		[
			"[$items.data.thumbnail|repeat:.layout:item:3:0|",
			"[$items|at:.layout|nth:3:0|repeat:item|.data.thumbnail|"
		],
		[
			"[$items.data.thumbnail|repeat:.layout:item:3:1|",
			"[$items|at:.layout|nth:3:1|repeat:item|.data.thumbnail|"
		],
		[
			"[$items.data.thumbnail|repeat:.layout:item:3:2|",
			"[$items|at:.layout|nth:3:2|repeat:item|.data.thumbnail|"
		],
		[
			"[$items.data.thumbnail|repeat:.wide.column:item|",
			"[$items|at:.wide.column|repeat:item|.data.thumbnail|"
		],
		[
			"|$elements.event.properties.label.anyOf.title|repeat:.item:labels",
			"|$elements.event.properties.label.anyOf|at:.item|repeat:labels|.title"
		],
		[
			"$elements.blog.properties.topics.items.anyOf.title|repeat:.item:option",
			"$elements.blog.properties.topics.items.anyOf|at:.item|repeat:option|.title"
		],
		[
			"$elements.blog.properties.topics.items.anyOf.title|repeat:.item:opt",
			"$elements.blog.properties.topics.items.anyOf|at:.item|repeat:opt|.title"
		],
		[
			"|repeat:a:topic",
			"|at:a|repeat:topic"
		],
		[
			"|repeat:.item:opt",
			"|at:.item|repeat:opt"
		],
		[
			"|repeat:a|",
			"|at:a|repeat:|"
		],
		[
			"|date]",
			"|date:date]"
		],
		[
			"|formatDate:",
			"|date:"
		],
		[
			"[$items.data.title|repeat:p:result]",
			"[$items|at:p|repeat:result|.data.title]"
		],
		[
			"[$items.data.title|repeat:.card:result]",
			"[$items|at:.card|repeat:result|.data.title]"
		],
		[
			"[result.data.headlines|html|slice:0:3|join::br]",
			"[result.headlines|slice:0:3|join:<br>|as:html]"
		],
		[
			"|now|",
			"|or:now|"
		],
		[
			"|toDate|",
			"|"
		],
		[
			"|toDate:month",
			"|date:isodate|parts:-:0:2"
		],
		[
			"|setDate:-1:month",
			"|clock:-1:M"
		],
		[
			"|setDate:+1:month",
			"|clock:1:M"
		],
		[
			"|includes:",
			"|has:"
		],
		[
			"|setDate:7:hour",
			"|clock:7:h"
		],
		[
			"|setDate:16:hour",
			"|clock:7:h"
		],
		[
			"|isoDate",
			"|date:isodate"
		],
		[
			"|ornull",
			"|as:null"
		],
		[
			"|or:nil",
			"|as:null"
		],
		[
			"|or:false",
			"|as:bool"
		],
		[
			"|not]",
			"|as:null]"
		],
		[
			"|text|",
			"|"
		],
		[
			"|eq:400:warning:|",
			"|switch:400:warning:|"
		],
		[
			"|neq:400:warning:|",
			"|neq:400|and:warning|or:|"
		],
		[
			"|attr:class:.column",
			"|at:.column|to:class"
		],
		[
			"[$items|repeat:.column+++++:item|",
			"[$items|at:.column:5|repeat:item|"
		],
		[
			"|repeat:.item:label",
			"|at:.item|repeat:label"
		],
		[
			"|attr:class:.item",
			"|at:.item|to:class"
		],
		[
			"|attr:class:p",
			"|at:p|to:class"
		],
		[
			"|attr:data-value:.item",
			"|at:.item|to:data-value"
		]
	];
	for (const [src, dst] of replacements) {
		str = str.replaceAll(getRe(src), dst);
	}
	return str;
}

exports.block_binding = exports.binding = function (block) {
	if (block.data.attr) {
		block.data.attr = bindJoin(doReplacements(bindSplit(block.data.attr)));
	}
	if (block.data.fill) {
		block.data.fill = bindJoin(doReplacements(bindSplit(block.data.fill)));
	}
	return block;
};

function bindSplit(str) {
	return '[' + str.trim().split('\n').join('|') + ']';
}

function bindJoin(str) {
	return str.slice(1, -1).split('|').join('\n');
}

function getRe(str) {
	if (typeof str == "string") return new RegExp(RegExp.escape(str), 'g');
	else return str;
}


exports.menu_group = function ({ data }) {
	if (data.responsive == "scroll") {
		data.responsive = null;
	}
};

exports.input_date_slot = exports.input_date_time = function ({ data }) {
	if (data.step === 60) data.step = 60 * 60;
	else if (data.step === undefined) data.step = null;
};

exports.social = function ({ data }) {
	if (data.networks) data.networks = data.networks.filter(x => ["facebook", "twitter", "linkedin"].includes(x));
};
