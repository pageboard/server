const Busboy = require('busboy');

module.exports = function(req, res, next) {
	const busboy = new Busboy({
		headers: req.headers
	});
	const body = {};
	busboy.on("field", (fieldname, value) => {
		body[fieldname] = value;
	});
	busboy.on("finish", () => {
		req.body = body;
		next();
	});
	req.pipe(busboy);
};
