exports.any = function (block) {
	const { expr } = block;
	if (!expr) return;
	const json = JSON.stringify(expr)
		.replaceAll(getRe("|!?|bmagnet:"), '|not:prune:')
		.replaceAll(getRe("|?|bmagnet:"), '|prune:');
	block.expr = JSON.parse(json);
};


function getRe(str) {
	return new RegExp(RegExp.escape(str), 'g');
}
