module.exports = class PdfModule {
	static name = 'pdf';
	static priority = 1;

	view(server) {
		this.app.opts.prerender.plugins.push(require.resolve('./lib/pdf'));
	}
};


