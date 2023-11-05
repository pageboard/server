module.exports = function (page) {
	page.on('idle', async () => {
		await page.evaluate(async () => {
			// loading polyfills require scripts to be disabled, but they are preloaded
			const list = Array.from(document.head.querySelectorAll('script')).slice(1);
			for (const node of list) {
				node.dataset.src = node.getAttribute('src');
				node.removeAttribute('src');
			}
		});
	});
};

