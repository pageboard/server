var inspector = require('url-inspector');

module.exports = function(opt) {
	return {service: init};
};

function init(All) {
	All.app.get('/inspector', function(req, res, next) {
		inspector(req.query.url, All.opt.inspector, function(err, info) {
			if (err) return next(err);
			res.send(info);
		});
	});
}

