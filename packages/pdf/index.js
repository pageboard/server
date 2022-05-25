module.exports = class PdfModule {
	static name = 'pdf';
	static priority = 1;

	viewRoutes(app) {
		const pdf = require('express-dom-pdf');
		pdf.plugins = ['upcache', 'render'];
	}
};
