module.exports = class PdfModule {
	static name = 'pdf';
	static priority = 1;

	viewRoutes(app) {
		app.opts.prerender.plugins.push(require.resolve('./lib/pdf'));
	}
};
