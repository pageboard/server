const Busboy = require('busboy');

module.exports = function(req, res, next) {
	const busboy = new Busboy({
		headers: req.headers
	});
	const body = {};
	busboy.on("field", function(fieldname, value) {
		body[fieldname] = value;
	});
	busboy.on("finish", function() {
		req.body = body;
		next();
	});
	req.pipe(busboy);
};
