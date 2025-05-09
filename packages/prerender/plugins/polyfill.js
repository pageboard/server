module.exports = function (page) {
	page.on('idle', async () => {
		await page.evaluate(async () => {
			// Polyfills logic is part of the core bundle.
			// Scripts that are *not* part of the core bundle can rely on polyfills
			const scripts = Array.from(
				document.head.querySelectorAll('script[src]:not([data-bundle="core"])')
			);
			for (const node of scripts) {
				node.dataset.src = node.getAttribute('src');
				node.removeAttribute('src');
			}
		});
	});
};
