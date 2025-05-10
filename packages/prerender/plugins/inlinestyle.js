module.exports = async function (page, settings, req, res) {
	await page.coverage.startCSSCoverage();
	page.on('idle', async () => {
		const cov = await page.coverage.stopCSSCoverage();
		const styles = cov.map(item => {
			const { text, ranges } = item;
			if (text == null) console.warn("No coverage for", item);
			else return ranges.map(range => {
				if (range.start >= 7 && text.slice(range.start - 7, range.start) == "@media ") {
					console.info("Dropped @media rule", text.slice(range.start - 7, range.stop));
					return '';
				} else {
					return text.slice(range.start, range.end).trim();
				}
			}).join('\n');
		}).join('\n');

		// https://www.caniemail.com/

		await page.evaluate(async styles => {
			const { head } = document;
			for (const node of head.querySelectorAll('link[rel="stylesheet"],style')) {
				node.remove();
			}
			const effectiveSheet = new CSSStyleSheet();
			effectiveSheet.replaceSync(styles);
			document.adoptedStyleSheets.push(effectiveSheet);
			const nodeList = new Set();
			function process(rule) {
				if (rule.cssRules?.length) {
					for (const sub of rule.cssRules) process(sub);
				} else if (!rule.media && !rule.selectorText) {
					// not a group but what, then ?
					console.warn("inlinestyle plugin ignores", rule.conditionText, rule.cssText);
					return;
				}
				const nodes = document.querySelectorAll(rule.selectorText);
				if (nodes.length == 0) {
					return;
				}
				const { style } = rule;
				const props = cssProperties(style.cssText);
				for (const node of nodes) {
					nodeList.add(node);
					if (!node.cssProperties) {
						node.cssProperties = new Set();
						for (const p of cssProperties(node.style.cssText)) {
							node.cssProperties.add(p);
						}
					}
					for (const p of props) node.cssProperties.add(p);
				}
			}
			for (const rule of effectiveSheet.cssRules) {
				process(rule);
			}
			for (const node of nodeList) {
				const styles = node.computedStyleMap();
				const list = [];
				for (const p of node.cssProperties) {
					list.push(`${p}: ${styles.get(p)}`);
				}
				if (list.length > 0) node.setAttribute('style', list.join(';'));
			}
			const walker = document.createTreeWalker(
				document,
				NodeFilter.SHOW_ELEMENT,
				node => node.nodeName == "HEAD"
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT
			);
			let node;
			while ((node = walker.nextNode())) {
				node.removeAttribute('class');
				node.removeAttribute('block-type');
				node.removeAttribute('block-content');
			}

			function cssProperties(text) {
				const set = new Set();
				for (const str of text.split(';')) {
					const name = str.split(':').shift().trim();
					if (name.length > 0) set.add(name);
				}
				return set;
			}
		}, styles);
	});
};
