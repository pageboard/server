exports = module.exports = function(opt) {
	if (!opt.inspector) opt.inspector = {};
	return {
		name: 'inspector',
		service: init
	};
};

function init(All) {
	var opt = All.opt;
	exports.get = function(url) {
		if (opt.inspector.url) {
			return require('got')({
				url: opt.inspector.url,
				query: {
					url: url
				}
			});
		} else {
			return new Promise(function(resolve, reject) {
				require('url-inspector')(url, opt.inspector, function(err, result) {
					if (err) return reject(err);
					resolve(result);
				});
			});
		}
	};
}

