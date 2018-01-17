exports = module.exports = function(opt) {
	if (!opt.inspector) opt.inspector = {};
	return {
		name: 'inspector',
		service: init
	};
};

function init(All) {
	var opt = All.opt;
	exports.get = function({url: url}) {
		var p;
		if (opt.inspector.url) {
			p = require('got')({
				url: opt.inspector.url,
				query: {
					url: url
				}
			});
		} else {
			p = new Promise(function(resolve, reject) {
				require('url-inspector')(url, opt.inspector, function(err, result) {
					if (err) return reject(err);
					resolve(result);
				});
			});
		}
		return p.then(function(result) {
			// here are fixed some inspector shortcomings
			if (result.icon == "data:/,") result.icon = null;
			return result;
		});
	};
}

