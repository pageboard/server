var objection = require('objection');
var ObjectionRest = require('objection-rest');

exports.route = function(app, api, config) {
	ObjectionRest(objection)
		.routePrefix('/api')
		.addModel(require('../../db/models/site'))
		.addModel(require('../../db/models/block'))
		.generate(app);
};

