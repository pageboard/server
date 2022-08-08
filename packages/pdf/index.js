module.exports = class PdfModule {
	static name = 'pdf';
	static priority = 1;

	viewRoutes(app) {
		this.router = require('express-dom-pdf')({
			plugins: ['upcache', 'render']
		});
	}
};
