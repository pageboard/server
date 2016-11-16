var objection = require('objection');
var ObjectionRest = require('objection-rest');

exports.route = function(app, api, config) {
	ObjectionRest(objection)
		.routePrefix('/api')
		.addModel(require('./models/site'))
		.addModel(require('./models/block'))
		.generate(app);
};

