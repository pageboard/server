module.exports = function (page, settings, req, res) {
	const { scripts } = settings;
	const languages = (req.get('Accept-Language') ?? '*')
		.split(',')
		.map(str => {
			const [loc, qval = 1] = str.split(';q=');
			return [loc.trim(), qval];
		})
		.sort(([, aqval], [, bqval]) => bqval - aqval)
		.map(([loc]) => loc)
		.filter(loc => loc != '*');

	scripts.push([languages => {
		Object.defineProperty(window.navigator, "languages", {
			configurable: true,
			get: function () { return languages; }
		});

	}, languages]);

	page.on('idle', async () => {
		const lang = await page.evaluate(() => document.documentElement.lang);
		if (lang) res.set('Content-Language', lang);
		res.vary('Accept-Language');
	});
};
